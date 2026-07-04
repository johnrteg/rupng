//
import { Account } from "@repo/api";
import { Events } from "@repo/system";
import { Sqs, RequestContext } from "@repo/services";

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
        await this.startProvisioningConsumer();
        await this.startLoginConsumer();          // auth.session.created → update member.lastLoginAt
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
    // auth.session.created (a login, from ANY auth path — password / passkey / MFA) → stamp the user's
    // member rows' lastLoginAt. Best-effort; a bus outage just means lastLoginAt lags.
    private async startLoginConsumer() : Promise<void>
    {
        try
        {
            await this.kafka.subscribeEvents( "account-lastlogin", Events.Object.AUTH_SESSION, async ( event ) =>
            {
                if( event.verb !== Events.Verb.CREATED ) return;
                const data = event.data as { userId? : string };
                if( data?.userId ) await this.updateLastLogin( data.userId );
            } );
            this.log.info( "account-lastlogin consumer subscribed", { topic: Events.Object.AUTH_SESSION } );
        }
        catch( error )
        {
            this.log.warn( "account-lastlogin consumer failed to start (bus unreachable?)", { error: String( error ) } );
        }
    }

    /////////////////////////////////////////////////////////////////////
    // stamp lastLoginAt on every membership row for a user (the members GSI userId returns full rows)
    private async updateLastLogin( userId : string ) : Promise<void>
    {
        const found = await this.dynamo.query<Record<string, unknown>>( "members", {
            IndexName:                 "userId",
            KeyConditionExpression:    "userId = :u",
            ExpressionAttributeValues: { ":u": userId },
        } );
        if( !found.ok ) return;

        const now : string = new Date().toISOString();
        for( const row of found.data ) await this.dynamo.put( "members", { ...row, lastLoginAt: now } );
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
