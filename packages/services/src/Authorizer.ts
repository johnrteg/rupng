//
import { createHash, timingSafeEqual } from "node:crypto";

import type { CloudResolver } from "@repo/cloud-manifest";
import { Environment, ResourceKind, physicalName } from "@repo/cloud-manifest";
import { Access } from "@repo/endpoint";

import { Dynamo } from "./aws/Dynamo";

//
// Authorizer — the ONE place the platform resolves a caller's role in an account from the membership/authz
// store. This is the authz layer (not a peer service's business logic): the SAME read the production API-
// Gateway Lambda authorizer performs, factored out so every Service.resolveRole — and that Lambda — share it
// instead of each reaching into the store ad hoc. Membership is owned by the account service's `members`
// table; this reads it as the authz store (by the userId GSI, scoped to the acting account).
//
// PROD: the gateway authorizer runs this once at the edge and forwards the role as a claim — services then
// trust the claim and never call this. DEV (no authorizer): Service.resolveRole calls this directly.
//
export class Authorizer
{
    // the membership/authz store — owned by the account service
    private static readonly STORE_SERVICE : string = "account";
    private static readonly STORE_TABLE   : string = "members";

    // the developer-API-key store — owned by the auth service (verified here as a shared authz read, the same
    // way the prod gateway authorizer would). A key is `rup_<keyId>.<secret>`; only the secret's hash is stored.
    private static readonly KEY_SERVICE : string = "auth";
    private static readonly KEY_TABLE   : string = "api_keys";
    private static readonly KEY_PREFIX  : string = "rup_";
    private static readonly KEY_ACTIVE  : string = "active";   // ApiKey.Status.ACTIVE (inlined to avoid an @repo/api dep)

    private readonly dynamo : Dynamo;

    constructor( cloud : CloudResolver )
    {
        this.dynamo = new Dynamo( cloud );
    }

    /////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    /** The caller's role in `accountId`, read from the membership/authz store; undefined if not a member. */
    public async roleFor( userId : string, accountId : string ) : Promise<Access.Role | undefined>
    {
        const env   : Environment = ( process.env.ENVIRONMENT as Environment ) ?? Environment.DEV;
        const table : string = physicalName( env, Authorizer.STORE_SERVICE, ResourceKind.TABLE, Authorizer.STORE_TABLE );

        const found = await this.dynamo.queryName<{ accountId : string; role : string }>( table, {
            IndexName:                 "userId",
            KeyConditionExpression:    "userId = :u",
            ExpressionAttributeValues: { ":u": userId },
        } );
        if( !found.ok ) return undefined;

        const row = found.data.find( ( m : { accountId : string } ) => m.accountId === accountId );
        return row && ( Access.LADDER as ReadonlyArray<string> ).includes( row.role ) ? ( row.role as Access.Role ) : undefined;
    }

    /////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    /** Verify a developer API key bearer (`rup_<keyId>.<secret>`) against the auth service's `api_keys` store and,
     *  on success, return the identity to ADOPT for the request (owner userId, the key's account, and the key's
     *  role). Returns undefined for any failure — malformed, unknown key, wrong secret, revoked, or expired.
     *  Read-only (no lastUsedAt write here) so the authz path stays side-effect-free, mirroring roleFor. */
    public async verifyApiKey( bearer : string ) : Promise<Authorizer.ApiKeyIdentity | undefined>
    {
        // parse `rup_<keyId>.<secret>` — the prefix + a single dot splitting the public id from the secret
        if( !bearer.startsWith( Authorizer.KEY_PREFIX ) ) return undefined;
        const body     : string = bearer.slice( Authorizer.KEY_PREFIX.length );
        const separator : number = body.indexOf( "." );
        if( separator <= 0 ) return undefined;
        const keyId  : string = body.slice( 0, separator );
        const secret : string = body.slice( separator + 1 );
        if( keyId === "" || secret === "" ) return undefined;

        // look up the key row by its partition key (keyId) in the auth-owned table
        const env   : Environment = ( process.env.ENVIRONMENT as Environment ) ?? Environment.DEV;
        const table : string = physicalName( env, Authorizer.KEY_SERVICE, ResourceKind.TABLE, Authorizer.KEY_TABLE );
        const found = await this.dynamo.queryName<Authorizer.ApiKeyRow>( table, {
            KeyConditionExpression:    "keyId = :k",
            ExpressionAttributeValues: { ":k": keyId },
        } );
        if( !found.ok || found.data.length === 0 ) return undefined;
        const row : Authorizer.ApiKeyRow = found.data[ 0 ];

        // gate on lifecycle: must be active and not past its TTL (expiresAt is epoch seconds)
        if( row.status !== Authorizer.KEY_ACTIVE ) return undefined;
        if( row.expiresAt && row.expiresAt < Math.floor( Date.now() / 1000 ) ) return undefined;

        // constant-time compare of the presented secret's hash against the stored hash
        if( !Authorizer.hashMatches( secret, row.hashedSecret ) ) return undefined;

        // adopt the key's role (already capped at the creator's role at mint) — validate it's a known ladder role
        if( !( Access.LADDER as ReadonlyArray<string> ).includes( row.role ) ) return undefined;
        return { userId: row.userId, accountId: row.accountId, role: row.role as Access.Role, keyId };
    }

    /////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    // timing-safe comparison of sha256(secret) against the stored hex hash (length-mismatch → no match, no throw)
    private static hashMatches( secret : string, storedHash : string ) : boolean
    {
        const computed : Buffer = createHash( "sha256" ).update( secret ).digest();
        const stored   : Buffer = Buffer.from( storedHash, "hex" );
        if( computed.length !== stored.length ) return false;
        return timingSafeEqual( computed, stored );
    }
}

export namespace Authorizer
{
    /** The identity adopted from a verified API key — the request runs AS this owner/account at the key's role. */
    export interface ApiKeyIdentity
    {
        userId    : string;
        accountId : string;
        role      : Access.Role;
        keyId     : string;
    }

    /** The stored `api_keys` row shape this authz read needs (secret hash + owner + role + lifecycle). */
    export interface ApiKeyRow
    {
        keyId        : string;
        hashedSecret : string;
        accountId    : string;
        userId       : string;
        role         : string;
        status       : string;
        expiresAt?   : number;
    }
}

export default Authorizer;
