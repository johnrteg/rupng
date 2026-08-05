//
import { Account, Media } from "@repo/api";
import { Access, Events } from "@repo/system";
import { Sqs, RequestContext } from "@repo/services";
import { RestfulEndpoint } from "@repo/endpoint";
import type { Type } from "@repo/common";

import AccountService from './AccountService';

//
// MAIN role — the authed account BFF: account CRUD + status, hierarchy/sub-accounts, members & roles,
// plans/pricing, subscriptions/invoicing, billing ops. (Writes live here; reads scale on the read role.)
//
// It also runs the **account-provisioning consumer**: when auth publishes `auth.user.created` (a new
// verified identity), this service mints that user's primary account + owner membership and republishes
// `account.account.created` — the middle link of the event-driven sign-up chain
// (auth.user.created → [account] → account.account.created → app).
//
export class AccountMainService extends AccountService
{
    private stopping : boolean = false;   // signals the SQS poll loop to exit on shutdown

    /////////////////////////////////////////////////////////////////////
    constructor()
    {
        super( AccountService.Role.MAIN );
    }

    /////////////////////////////////////////////////////////////////////
    protected async init() : Promise<void>
    {
        await super.init();
        // Kafka consumers only when a bus is configured — skip quietly in local dev (no brokers) instead of
        // three "bus unreachable?" WARNs; the SQS invite consumer is independent of Kafka and always runs.
        if( this.kafka.configured() )
        {
            await this.startProvisioningConsumer();
            await this.startAvatarConsumer();         // media.asset (USER) → denormalize avatarAssetId onto member rows
        }
        else this.log.info( "account Kafka consumers skipped — no Kafka brokers configured (dev)" );
        void this.startInviteConsumer();          // SQS invite-requests → write invite + stub email (long-poll loop)
    }

    /////////////////////////////////////////////////////////////////////
    // stop the SQS poll loop before the base tears down (so it doesn't keep the process alive past SIGINT)
    protected override async aboutToQuit() : Promise<void>
    {
        this.stopping = true;
        await super.aboutToQuit();
    }

    /////////////////////////////////////////////////////////////////////
    // Subscribe to auth.user. Best-effort: a Kafka outage must not stop the service from booting (the
    // HTTP API still serves) — log and carry on; provisioning resumes when the bus is reachable.
    private async startProvisioningConsumer() : Promise<void>
    {
        try
        {
            await this.kafka.subscribeEvents( "account-provisioning", Events.Object.AUTH_USER, async ( event ) =>
            {
                if( event.verb === Events.Verb.CREATED )
                    await this.provisionAccount( event.data as AccountMainService.NewUser );
                // returning normally COMMITS the offset; THROWING redelivers (at-least-once) — provisionAccount is idempotent.
            } );
            this.log.info( "account-provisioning consumer subscribed", { topic: Events.Object.AUTH_USER } );
        }
        catch( error )
        {
            this.log.warn( "account-provisioning consumer failed to start (bus unreachable?) — accounts won't auto-provision until restart", { error: String( error ) } );
        }
    }

    /////////////////////////////////////////////////////////////////////
    // Resolve the caller's role (the base DynamoDB-backed lookup), then fire a throttled, best-effort
    // "last accessed this account" touch — never blocks or fails the request. This is the per-account
    // counterpart to auth's own universal `users.lastLoginAt` (stamped at login, any account or none):
    // a login event alone carries no accountId, so it can't express "accessed THIS account" — only a
    // request actually scoped by X-Account (resolved into `auth.accountId` here) can. Known limitation:
    // this only fires for endpoints declaring a minimum `access` role and for JWT-authenticated callers
    // — API-key auth skips `resolveRole` entirely (Service.processEndpoint), so API-key traffic never
    // touches `lastAccessedAt`.
    protected override async resolveRole( auth : RestfulEndpoint.Authentication ) : Promise<Access.Role>
    {
        const role : Access.Role = await super.resolveRole( auth );
        if( auth.userId && auth.accountId ) void this.touchLastAccessed( auth.userId, auth.accountId );
        return role;
    }

    // throttle window for touchLastAccessed — don't hammer `members` with a put on every single request
    private static readonly ACCESS_TOUCH_THROTTLE_MS : number = 10 * 60 * 1000;

    /////////////////////////////////////////////////////////////////////
    // stamp lastAccessedAt on the ONE membership row for (userId, accountId) — throttled so rapid
    // repeated requests in the same session don't write on every call. Best-effort; never throws.
    private async touchLastAccessed( userId : string, accountId : string ) : Promise<void>
    {
        const found : Type.Result<Record<string, unknown> | undefined> = await this.dynamo.get<Record<string, unknown>>( "members", { accountId, userId } );
        if( !found.ok || !found.data ) return;   // not a member (or a read failure) — nothing to stamp

        const last : number = found.data.lastAccessedAt ? Date.parse( found.data.lastAccessedAt as string ) : 0;
        if( Date.now() - last < AccountMainService.ACCESS_TOUCH_THROTTLE_MS ) return;   // touched recently — skip the write

        const now : string = new Date().toISOString();
        const wrote : Type.Result<void> = await this.dynamo.put( "members", { ...found.data, lastAccessedAt: now } );
        if( !wrote.ok ) this.log.warn( "lastAccessedAt stamp failed", { userId, accountId, error: wrote.error } );
    }

    /////////////////////////////////////////////////////////////////////
    // media.asset (USER scope) → the user (set/replaced) their avatar; denormalize the guid onto their member
    // rows so member lists (GetMembers) carry it. Best-effort; a bus outage just means avatars lag.
    private async startAvatarConsumer() : Promise<void>
    {
        try
        {
            await this.kafka.subscribeEvents( "account-avatar", Events.Object.MEDIA_ASSET, async ( event ) : Promise<void> =>
            {
                if( event.verb === Events.Verb.DELETED ) return;
                const asset = event.data as { scope? : string; scopeId? : string; guid? : string };
                if( asset?.scope !== Media.Scope.USER || !asset.scopeId || !asset.guid ) return;
                await this.updateAvatar( asset.scopeId, asset.guid );
            } );
            this.log.info( "account-avatar consumer subscribed", { topic: Events.Object.MEDIA_ASSET } );
        }
        catch( error )
        {
            this.log.warn( "account-avatar consumer failed to start (bus unreachable?)", { error: String( error ) } );
        }
    }

    // stamp avatarAssetId on every membership row for a user (the members GSI userId returns full rows)
    private async updateAvatar( userId : string, avatarAssetId : string ) : Promise<void>
    {
        const found = await this.dynamo.query<Record<string, unknown>>( "members", {
            IndexName:                 "userId",
            KeyConditionExpression:    "userId = :u",
            ExpressionAttributeValues: { ":u": userId },
        } );
        if( !found.ok ) return;
        for( const row of found.data ) await this.dynamo.put( "members", { ...row, avatarAssetId } );
    }

    /////////////////////////////////////////////////////////////////////
    // SQS invite-requests poll loop — decoupled/persistent invite processing (POST /invites enqueues here).
    // Best-effort + at-least-once: a failed process is NOT deleted → SQS redelivers after the visibility
    // timeout, DLQs after maxReceiveCount. Runs until shutdown flips `stopping`.
    private async startInviteConsumer() : Promise<void>
    {
        this.log.info( "invite consumer started (SQS invite-requests)" );
        while( !this.stopping )
        {
            try
            {
                const received = await this.sqs.receive( "invite-requests", 10, 10 );
                if( !received.ok ) { await this.delay( 5000 ); continue; }   // queue missing / unreachable — back off

                for( const message of received.data )
                {
                    // re-link to the request that enqueued this message (the transaction id rides as an SQS
                    // message attribute) so this consumer's logs + any events it emits stay on the same chain
                    await RequestContext.run( { transactionId: Sqs.transactionId( message ) }, async () : Promise<void> =>
                    {
                        try
                        {
                            await this.processInviteRequest( JSON.parse( message.Body ?? "{}" ) as AccountMainService.InviteRequest );
                            if( message.ReceiptHandle ) await this.sqs.delete( "invite-requests", message.ReceiptHandle );
                        }
                        catch( err )
                        {
                            this.log.warn( "invite request failed (will redeliver)", { error: String( err ) } );   // leave for redelivery / DLQ
                        }
                    } );
                }
            }
            catch( error )
            {
                this.log.warn( "invite consumer receive failed — backing off", { error: String( error ) } );
                await this.delay( 5000 );
            }
        }
        this.log.info( "invite consumer stopped" );
    }

    private delay( ms : number ) : Promise<void> { return new Promise( ( resolve ) => setTimeout( resolve, ms ) ); }

    /////////////////////////////////////////////////////////////////////
    // The invite NOTIFICATION step (the durable invite row is written synchronously by PostInviteImpl). Load
    // the invite, "send" the (stub) email, and flip PENDING → INVITED. Idempotent: a missing / terminal invite
    // (cancelled / accepted / declined) is a no-op. Throwing redelivers via SQS.
    private async processInviteRequest( req : AccountMainService.InviteRequest ) : Promise<void>
    {
        const accountId : string = req.accountId ?? "";
        const inviteId  : string = req.inviteId ?? "";
        if( accountId === "" || inviteId === "" ) return;   // malformed → drop

        const found = await this.dynamo.get<Record<string, string>>( "invites", { accountId, inviteId } );
        if( !found.ok )   throw new Error( `invite read failed for ${accountId}/${inviteId}` );   // throw → SQS redelivers
        if( !found.data ) { this.log.info( "invite gone before send — skipping", { accountId, inviteId } ); return; }

        const active : ReadonlyArray<string> = [ Account.InviteStatus.PENDING, Account.InviteStatus.INVITED ];
        if( !active.includes( found.data.status ?? Account.InviteStatus.PENDING ) )
        {
            this.log.info( "invite no longer active — skipping send", { accountId, inviteId, status: found.data.status } );
            return;
        }

        const now : string = new Date().toISOString();
        const put = await this.dynamo.put( "invites", { ...found.data, accountId, inviteId, status: Account.InviteStatus.INVITED, lastSentAt: now } );
        if( !put.ok ) throw new Error( `invite status write failed for ${accountId}/${inviteId}` );

        // STUB email — real send is a later email-service integration
        this.log.info( "invite.email.stub", { accountId, inviteId, email: found.data.email, role: found.data.role } );
    }

    /////////////////////////////////////////////////////////////////////
    // On registration (auth.user.created), give the new user a PERSONAL account — UNLESS they were invited.
    // Idempotent: skips if the user already has a membership (a redelivered event can't duplicate). Invited
    // users skip the personal account entirely and instead join the account(s) they were invited to (matched
    // by email on their first login — see GetMembershipsImpl.materializeInvites); if they want a scratch space
    // they make a sub-account. The actual account creation + event lives in the shared base
    // (AccountService.provisionPersonalAccount) so the lazy-fallback path agrees.
    private async provisionAccount( user : AccountMainService.NewUser ) : Promise<void>
    {
        const userId : string = user.userId;
        if( !userId ) return;

        const existing = await this.dynamo.query<{ accountId : string }>( "members", {
            IndexName:                 "userId",
            KeyConditionExpression:    "userId = :u",
            ExpressionAttributeValues: { ":u": userId },
        } );
        if( existing.ok && existing.data.length > 0 )
        {
            this.log.info( "account already provisioned for user — skipping", { userId } );
            return;
        }

        // Invited users join the account(s) they were invited to instead of getting a personal account. We
        // materialize the invite HERE (not just at first login) because the auth.user.created event carries a
        // RELIABLE email — the dev access token doesn't, so the login path can't match invites on its own.
        const fullName : string = `${ user.firstName ?? "" } ${ user.lastName ?? "" }`.trim();
        const joined   : number = await this.joinPendingInvites( userId, user.email, fullName );
        if( joined > 0 )
        {
            this.log.info( "user joined invited account(s) — skipping personal account", { userId, joined } );
            return;
        }

        const account : Account.Entity | null = await this.provisionPersonalAccount( {
            userId, email: user.email, firstName: user.firstName, lastName: user.lastName, name: user.accountName,
        } );
        // Fail LOUD, not silent: throwing redelivers the at-least-once event and surfaces the error, rather
        // than leaving the user with no account.
        if( !account ) throw new Error( `personal account provisioning failed for ${userId}` );

        this.log.info( "provisioned account for new user", { userId, accountId: account.id } );
    }
}

export namespace AccountMainService
{
    /** The auth.user.created payload this service consumes (mirrors auth's UserStore.Confirmed). */
    export interface NewUser
    {
        userId       : string;
        email?       : string;
        phone?       : string;
        firstName?   : string;
        lastName?    : string;
        accountName? : string;
    }

    /** The SQS invite-request payload (POST /invites enqueues this; the invite consumer processes it). */
    export interface InviteRequest
    {
        accountId  : string;
        inviteId   : string;
        email      : string;
        role       : string;
        invitedAt? : string;
        invitedBy? : string;
    }
}

export default AccountMainService;
