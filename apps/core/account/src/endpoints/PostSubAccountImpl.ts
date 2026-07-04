//
import { randomUUID } from "node:crypto";

import { PostSubAccount, Account, AccountConfig } from '@repo/api';
import { NetworkUtils, type Type } from '@repo/common';
import { RestfulEndpoint, Access } from '@repo/endpoint';
import { Events } from '@repo/system';
import AccountService from '../services/AccountService';

//
// Create a sub-account under the acting account. The caller (an ACCOUNT admin — enforced by the authorize
// gate) becomes the new account's OWNER and an ACCOUNT-role member, so they can manage it directly and it's
// never orphaned. Enforces the configured hierarchy caps before writing:
//   • maxDepth                — how deep sub-accounts may nest (walk the parent chain)
//   • maxSubAccountsPerParent — fan-out cap per parent (count existing children)
// and seeds the new account's parentAccess from config (defaultParentAccess). Publishes account.account.created
// (best-effort) so downstream services learn of the new account, mirroring registration provisioning.
//
export class PostSubAccountImpl extends PostSubAccount
{
    private service : AccountService;
    constructor( service : AccountService ) { super(); this.service = service; }

    ///////////////////////////////////////////////////////////////////////////////////////////
    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        if( !auth.userId )   return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };
        const parentId : string | undefined = auth.accountId;
        if( !parentId )      return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "no acting account (X-Account)" } };

        const name : string = ( this.body?.name ?? "" ).trim();
        if( name === "" )    return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "a name is required" } };

        // ── hierarchy policy (live config, fall back to the seeded defaults) ──────────────────────
        const config : AccountConfig.Config = await this.service.accountConfig();

        const depth : number = await this.depthOf( parentId, config.hierarchy.maxDepth );
        if( depth + 1 > config.hierarchy.maxDepth )
            return { status: NetworkUtils.Status.CONFLICT, data: { message: `maximum sub-account depth (${ config.hierarchy.maxDepth }) reached` } };

        const siblings = await this.service.dynamo.query<Record<string, string>>( "accounts", {
            IndexName:                 "parentId",
            KeyConditionExpression:    "parentId = :p",
            ExpressionAttributeValues: { ":p": parentId },
        } );
        if( siblings.ok && siblings.data.length >= config.hierarchy.maxSubAccountsPerParent )
            return { status: NetworkUtils.Status.CONFLICT, data: { message: `maximum sub-accounts per account (${ config.hierarchy.maxSubAccountsPerParent }) reached` } };

        // read the parent account — its organization is the default for the sub-account, and any carry-over
        // fields (e.g. address) are copied from it (server-side, authoritative).
        const parent : Type.Result<( Account.Entity ) | undefined> = await this.service.dynamo.get<Account.Entity>( "accounts", { accountId: parentId } );
        const parentEntity : Account.Entity | undefined = parent.ok ? parent.data : undefined;

        // ── build + write the new account row (creator = owner) ───────────────────────────────────
        const now       : string = new Date().toISOString();
        const accountId : string = randomUUID();
        const claims     : Record<string, unknown> = auth.claims ?? {};
        const creatorEmail : string = String( claims[ "email" ] ?? "" ).trim();
        const creatorName  : string = this.claimName( claims );

        // organization: explicit choice → parent's → OTHER; address: copy the parent's only if requested
        const organization : Account.Organization = this.body?.organization ?? parentEntity?.organization ?? { type: Account.OrganizationType.OTHER };
        const address : Account.Entity[ "address" ] = ( this.body?.carryOver?.address && parentEntity?.address )
            ? parentEntity.address
            : ( {} as Account.Entity[ "address" ] );

        const account : Account.Entity =
        {
            id:              accountId,
            parentId:        parentId,
            ownerId:         auth.userId,
            name:            name,
            status:          Account.Status.ACTIVE,
            organization:    organization,
            parentAccess:    config.hierarchy.defaultParentAccess === "open" ? Account.ParentAccess.OPEN : Account.ParentAccess.GRANTED,
            tags:            [],
            suspendedReason: "",
            poc:             { name: creatorName || name, email: ( creatorEmail || "" ) as Type.Email },
            timezone:        "UTC" as Type.TimeZone,
            featureFlags:    {},
            joinCode:        accountId.slice( 0, 8 ),
            address:         address,
            createdAt:       now,
            modifiedAt:      now,
        };
        const accountWrite : Record<string, unknown> = { ...( account as unknown as Record<string, unknown> ), accountId };
        const accountPut = await this.service.dynamo.put( "accounts", accountWrite );
        if( !accountPut.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "sub-account write failed" } };

        // the creator becomes an ACCOUNT admin member of the new account (denormalized identity for the list)
        const memberPut = await this.service.dynamo.put( "members", {
            accountId,
            userId:    auth.userId,
            role:      Access.AccountRole.ACCOUNT,
            status:    Account.MemberStatus.ACTIVE,
            createdAt: now,
            email:     creatorEmail || undefined,
            name:      creatorName  || undefined,
        } );
        if( !memberPut.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "sub-account owner write failed" } };

        // announce the new account to the rest of the platform (best-effort — the account already exists)
        try
        {
            await this.service.kafka.publishEvent( {
                version:    "1",
                eventId:    randomUUID(),
                occurredAt: now,
                accountId,
                actor:      { kind: Events.ActorKind.USER, id: auth.userId },
                object:     Events.Object.ACCOUNT_ACCOUNT,
                verb:       Events.Verb.CREATED,
                action:     Events.actionOf( Events.Object.ACCOUNT_ACCOUNT, Events.Verb.CREATED ),
                target:     { type: "account", id: accountId },
                source:     { channel: Events.SourceChannel.API },
                outcome:    Events.Outcome.SUCCESS,
                data:       account,
                sinks:      [ Events.Sink.KAFKA ],
            } );
        }
        catch( err ) { this.service.log.warn( "sub-account created event publish failed (non-fatal)", err ); }

        const summary : Account.SubAccount = { id: accountId, name, status: account.status, ownerId: auth.userId, createdAt: now };
        // 200 (not 201): the web RestfulService marks reply.ok only for a 200 status
        return { status: NetworkUtils.Status.OK, data: { account: summary } };
    }

    ///////////////////////////////////////////////////////////////////////////////////////////
    // depth of `accountId` in the hierarchy (top-level = 1). Walks parentId up to the root; capped at
    // maxDepth+1 iterations so a malformed cycle can't loop forever.
    private async depthOf( accountId : string, maxDepth : number ) : Promise<number>
    {
        let depth   : number = 1;
        let current : string | undefined = accountId;
        for( let hops : number = 0; hops <= maxDepth + 1 && current; hops++ )
        {
            const row : Type.Result<{ parentId? : string } | undefined> = await this.service.dynamo.get<{ parentId? : string }>( "accounts", { accountId: current } );
            const parent : string | undefined = row.ok && row.data ? row.data.parentId : undefined;
            if( !parent ) break;
            depth++;
            current = parent;
        }
        return depth;
    }

    ///////////////////////////////////////////////////////////////////////////////////////////
    // a display name from the JWT claims (name, or given+family), or "" if none
    private claimName( claims : Record<string, unknown> ) : string
    {
        const name : string = String( claims[ "name" ] ?? "" ).trim();
        if( name !== "" ) return name;
        return `${ String( claims[ "given_name" ] ?? "" ) } ${ String( claims[ "family_name" ] ?? "" ) }`.trim();
    }
}

export default PostSubAccountImpl;
