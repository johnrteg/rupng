//
import { randomUUID, randomBytes, createHash } from "node:crypto";

import { ApiKey } from "@repo/api";
import { Access } from "@repo/endpoint";
import { Dynamo } from "@repo/services";
import type { Type } from "@repo/common";

//
// ApiKeyStore — the data layer for developer API keys (media-/auth `api_keys` table). Mints keys as
// `rup_<keyId>.<secret>` (only a SHA-256 hash of the secret is stored — the full key is shown once), lists an
// account's keys (secret-free), and revokes. A key is tied to ONE account and carries a max `role`; the mint
// caller can't exceed their own role. (The Authorizer's verify path — Bearer rup_<keyId>.<secret> → account +
// role — is a separate follow-up; this store owns creation/listing/revocation.)
//
export class ApiKeyStore
{
    private static readonly TABLE : string = "api_keys";

    ////////////////////////////////////////////////////////////////////////////////////////////
    constructor( private readonly dynamo : Dynamo ) {}

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** Mint a key for `accountId`, capped at `callerRole` (the requested role can't exceed the creator's).
     *  Returns the stored view + the FULL one-time secret `rup_<keyId>.<secret>`, or ok:false with a reason. */
    public async mint( input : ApiKeyStore.MintInput ) : Promise<Type.Result<{ view : ApiKey.View; secret : string }>>
    {
        // role cap — the caller must themselves meet the requested role on the Access ladder
        if( !Access.isAllowed( input.callerRole, input.role ) )
            return { ok: false, error: "cannot mint a key with a higher role than your own" };

        const keyId  : string = randomUUID().replace( /-/g, "" );          // compact public lookup half
        const secret : string = randomBytes( 24 ).toString( "base64url" ); // the private half (shown once)
        const hashedSecret : string = createHash( "sha256" ).update( secret ).digest( "hex" );
        const now : string = new Date().toISOString();
        const expiresAt : number | undefined = input.expiresInDays ? Math.floor( Date.now() / 1000 ) + input.expiresInDays * 86400 : undefined;

        const row : ApiKeyStore.Row =
        {
            keyId, hashedSecret, accountId: input.accountId, userId: input.userId,
            name: input.name, role: input.role, tier: input.tier ?? ApiKey.Tier.PUBLIC,
            status: ApiKey.Status.ACTIVE, createdAt: now, ...( expiresAt ? { expiresAt } : {} ),
        };
        const wrote : Type.Result<void> = await this.dynamo.put( ApiKeyStore.TABLE, { ...row } );
        if( !wrote.ok ) return { ok: false, error: wrote.error };

        return { ok: true, data: { view: ApiKeyStore.toView( row ), secret: `rup_${ keyId }.${ secret }` } };
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** List an account's keys (secret-free views), newest first. */
    public async list( accountId : string ) : Promise<Type.Result<Array<ApiKey.View>>>
    {
        const got : Type.Result<Array<ApiKeyStore.Row>> = await this.dynamo.query<ApiKeyStore.Row>( ApiKeyStore.TABLE, {
            IndexName: "accountId",
            KeyConditionExpression: "accountId = :accountId",
            ExpressionAttributeValues: { ":accountId": accountId },
        } );
        if( !got.ok ) return { ok: false, error: got.error };
        const views : Array<ApiKey.View> = got.data
            .map( ( row : ApiKeyStore.Row ) : ApiKey.View => ApiKeyStore.toView( row ) )
            .sort( ( left : ApiKey.View, right : ApiKey.View ) : number => right.createdAt.localeCompare( left.createdAt ) );
        return { ok: true, data: views };
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** Revoke a key (set status = revoked) — only if it belongs to `accountId`. Returns whether it was found. */
    public async revoke( accountId : string, keyId : string ) : Promise<Type.Result<boolean>>
    {
        const got : Type.Result<ApiKeyStore.Row | undefined> = await this.dynamo.get<ApiKeyStore.Row>( ApiKeyStore.TABLE, { keyId } );
        if( !got.ok ) return { ok: false, error: got.error };
        if( !got.data || got.data.accountId !== accountId ) return { ok: true, data: false };   // not found / not this account

        const wrote : Type.Result<void> = await this.dynamo.put( ApiKeyStore.TABLE, { ...got.data, status: ApiKey.Status.REVOKED } );
        if( !wrote.ok ) return { ok: false, error: wrote.error };
        return { ok: true, data: true };
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // strip the stored row to its secret-free wire view
    private static toView( row : ApiKeyStore.Row ) : ApiKey.View
    {
        return {
            keyId: row.keyId, name: row.name, role: row.role, tier: row.tier, status: row.status,
            scopes: row.scopes, createdAt: row.createdAt, expiresAt: row.expiresAt, lastUsedAt: row.lastUsedAt,
        };
    }
}

export namespace ApiKeyStore
{
    /** Inputs to mint a key. `callerRole` is the creator's resolved role (the cap). */
    export interface MintInput
    {
        accountId     : string;
        userId        : string;
        callerRole    : Access.Role;
        name          : string;
        role          : Access.Role;
        tier?         : ApiKey.Tier;
        expiresInDays? : number;
    }

    /** The stored DynamoDB row — the wire view plus the secret hash + owner keys (never sent to the client). */
    export interface Row extends ApiKey.View { hashedSecret : string; accountId : string; userId : string; }
}

export default ApiKeyStore;
