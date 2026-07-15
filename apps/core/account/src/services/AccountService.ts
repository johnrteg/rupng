//
import { randomUUID } from "node:crypto";

import { Application, Service, Ports, Register, Dynamo, Kafka, Sqs } from "@repo/services";
import { AccountConfig, Account } from "@repo/api";
import { Access, Events } from "@repo/system";

//
// common account server base — accounts, hierarchy, membership, plans/pricing, subscriptions,
// invoicing, usage, and the block list. Every concrete role extends this.
//
export class AccountService extends Service
{
    // AWS facades this service owns (resolved against this service's CloudManifest):
    private _dynamo? : Dynamo;
    private _kafka?  : Kafka;
    private _sqs?    : Sqs;

    ///////////////////////////////////////////////////////////////////////////////////////
    constructor( role : AccountService.Role )
    {
        // identity = Register.Service.ACCOUNT (+ role → "account:main"); default to this role's port in
        // the ACCOUNT block for local dev; a deploy's env PORT overrides it
        super( Register.Service.ACCOUNT, role, AccountService.PORT[ role ] );

        // __dirname resolves to apps/core/account/bin/services at runtime; loadPackageInfo walks up to
        // the nearest package.json (apps/core/account/package.json)
        const pkg : Application.PackageInfo = this.loadPackageInfo( __dirname );
        this.setVersion( pkg.version );
        this.log.info( "version", { name: pkg.name, version: pkg.version } );
    }

    ///////////////////////////////////////////////////////////////////////////////////////
    /** Dynamo facade — the account tables (keyed by the logical table keys in CloudManifest). Lazy + cached. */
    public get dynamo() : Dynamo { return this._dynamo ??= new Dynamo( this.cloud ); }

    /** Kafka facade — consumes auth.user, publishes account.* events. Lazy + cached. */
    public get kafka() : Kafka { return this._kafka ??= new Kafka( this.cloud ); }

    ///////////////////////////////////////////////////////////////////////////////////////
    /** Publish an `account.*` lifecycle event (events dictionary). Best-effort — a bus miss is logged, never
     *  fails the request. `data` is the entity's `@repo/api` wire model; `actorUserId` (if given) makes it a
     *  USER-actored event, else a SERVICE-actored one. */
    public async emit( object : Events.Object, verb : Events.Verb, targetType : string, targetId : string, accountId : string, data : unknown, actorUserId? : string ) : Promise<void>
    {
        const env : Events.Envelope = Events.envelope( { object, verb, accountId, target: { type: targetType, id: targetId }, data, actorUserId } );
        const published = await this.kafka.publishEvent( env );
        if( !published.ok ) this.log.warn( "account event publish failed", { action: env.action, targetId, error: published.error } );
    }

    /** SQS facade — decoupled work queues (e.g. invite-requests). Lazy + cached. */
    public get sqs() : Sqs { return this._sqs ??= new Sqs( this.cloud ); }

    ///////////////////////////////////////////////////////////////////////////////////////
    /** The live runtime config (AppConfig config/settings), falling back to the seeded defaults. Exposed so
     *  endpoint impls (which can't reach the protected `appConfig`) can read hierarchy/membership policy. */
    public async accountConfig() : Promise<AccountConfig.Config>
    {
        const got : { ok : boolean; data? : AccountConfig.Config } = await this.appConfig.json<AccountConfig.Config>( "config", "settings" );
        return got.ok && got.data ? got.data : AccountConfig.DEFAULT;
    }

    ///////////////////////////////////////////////////////////////////////////////////////
    /**
     * Create a user's PERSONAL account + owner membership (and announce it via `account.account.created`).
     * The ONE place a personal account is minted, so both provisioning paths agree:
     *   1. registration — `AccountMainService.provisionAccount` (auth.user.created consumer), and
     *   2. the LAZY FALLBACK — `GetMembershipsImpl` calls this when a user loads with **zero memberships and
     *      no pending invite** (e.g. their invite was cancelled after they registered but before first login,
     *      so `provisionAccount` had skipped the personal account). This guarantees a registered user is never
     *      left with nowhere to land, without warning them about an invite they may never have seen.
     *
     * Callers are responsible for the "should we create one?" decision (existing-membership / pending-invite
     * guards); this method just performs the creation. Best-effort identity: in dev the caller may only have
     * the Cognito `sub` (access tokens carry no email/name), so the account falls back to "New Account".
     * Returns the created entity, or null on write failure.
     */
    public async provisionPersonalAccount( input : AccountService.ProvisionInput ) : Promise<Account.Entity | null>
    {
        if( !input.userId ) return null;

        const now       : string = new Date().toISOString();
        const accountId : string = randomUUID();
        const fullName  : string = ( `${ input.firstName ?? "" } ${ input.lastName ?? "" }`.trim() ) || ( input.name ?? "" );

        const account : Account.Entity =
        {
            id:              accountId,
            ownerId:         input.userId,                 // the registrant owns their personal account (their reset/home target)
            name:            fullName || "New Account",    // no account-name prompt — default to the user's name
            status:          Account.Status.ACTIVE,
            organization:    { type: Account.OrganizationType.OTHER },
            parentAccess:    Account.ParentAccess.GRANTED,
            tags:            [],
            suspendedReason: "",
            poc:             { name: fullName, email: input.email ?? "" },
            timezone:        "UTC",
            featureFlags:    {},
            joinCode:        accountId.slice( 0, 8 ),
            address:         {} as Account.Entity[ "address" ],
            createdAt:       now,
            modifiedAt:      now,
        };

        // the accounts table PK is `accountId` (the entity exposes it as `id`) — write the key alongside
        const accountPut = await this.dynamo.put( "accounts", { ...( account as unknown as Record<string, unknown> ), accountId } );
        if( !accountPut.ok ) { this.log.error( "personal account write failed", { accountId, error: accountPut.error } ); return null; }

        // the owner membership — ACCOUNT (admin) role, identity denormalized for the members list
        const memberPut = await this.dynamo.put( "members", {
            accountId, userId: input.userId,
            role:      Access.AccountRole.ACCOUNT,
            status:    Account.MemberStatus.ACTIVE,
            createdAt: now,
            email:     input.email || undefined,
            name:      fullName    || undefined,
        } );
        if( !memberPut.ok ) { this.log.error( "personal account owner write failed", { accountId, error: memberPut.error } ); return null; }

        // owner joined (member created)
        void this.emit( Events.Object.ACCOUNT_MEMBER, Events.Verb.CREATED, "member", input.userId, accountId,
            { userId: input.userId, role: Access.AccountRole.ACCOUNT, status: Account.MemberStatus.ACTIVE, owner: true, name: fullName || undefined, email: input.email || undefined, createdAt: now }, input.userId );

        // announce to the rest of the platform (best-effort — the account already exists)
        try
        {
            await this.kafka.publishEvent( {
                version:    "1",
                eventId:    randomUUID(),
                occurredAt: now,
                accountId,
                actor:      { kind: Events.ActorKind.SERVICE, id: "account", onBehalfOfId: input.userId },
                object:     Events.Object.ACCOUNT_ACCOUNT,
                verb:       Events.Verb.CREATED,
                action:     Events.actionOf( Events.Object.ACCOUNT_ACCOUNT, Events.Verb.CREATED ),
                target:     { type: "account", id: accountId },
                source:     { channel: Events.SourceChannel.JOB },
                outcome:    Events.Outcome.SUCCESS,
                data:       account,
                sinks:      [ Events.Sink.KAFKA ],
            } );
        }
        catch( err ) { this.log.warn( "account.account.created publish failed (non-fatal)", err ); }

        return account;
    }

    ///////////////////////////////////////////////////////////////////////////////////////
    /** Does this email have an outstanding invite (pending / invited)? Matched on the invites `email` GSI
     *  (stored lowercased). Drives whether a new registrant / orphaned user gets a personal account or just
     *  joins the account they were invited to. */
    public async hasPendingInvite( email? : string ) : Promise<boolean>
    {
        const normalized : string = ( email ?? "" ).trim().toLowerCase();
        if( normalized === "" ) return false;

        const invites = await this.dynamo.query<{ status? : string }>( "invites", {
            IndexName:                 "email",
            KeyConditionExpression:    "email = :e",
            ExpressionAttributeValues: { ":e": normalized },
        } );
        if( !invites.ok ) return false;

        const active : ReadonlyArray<string> = [ Account.InviteStatus.PENDING, Account.InviteStatus.INVITED ];
        return invites.data.some( ( invite ) => active.includes( invite.status ?? Account.InviteStatus.PENDING ) );
    }

    ///////////////////////////////////////////////////////////////////////////////////////
    /**
     * Materialize a user's outstanding invites (pending / invited) into memberships — the ONE place invites
     * become memberships, so registration and login agree. For each active invite matched on `email`: create
     * the membership at the invited role (if not already a member) and mark the invite `accepted`. The member
     * `createdAt` is stamped with the invite's `invitedAt` so "first invite wins" landing order holds.
     *
     * IMPORTANT — the caller must pass a RELIABLE email. The dev access token carries no `email` claim, so
     * `auth.claims.email` is empty; use the auth.user.created event email at registration, or a denormalized
     * member-row email at login. Returns the number of NEW memberships created.
     */
    public async joinPendingInvites( userId : string, email? : string, name? : string ) : Promise<number>
    {
        const normalized : string = ( email ?? "" ).trim().toLowerCase();
        if( !userId || normalized === "" ) return 0;

        const pending = await this.dynamo.query<Record<string, string>>( "invites", {
            IndexName:                 "email",
            KeyConditionExpression:    "email = :e",
            ExpressionAttributeValues: { ":e": normalized },
        } );
        if( !pending.ok ) return 0;

        const active : ReadonlyArray<string> = [ Account.InviteStatus.PENDING, Account.InviteStatus.INVITED ];
        const invites : Array<Record<string, string>> = pending.data
            .filter( ( invite ) => active.includes( invite.status ?? Account.InviteStatus.PENDING ) )
            .sort( ( a, b ) => String( a.invitedAt ?? "" ).localeCompare( String( b.invitedAt ?? "" ) ) );

        const now : string = new Date().toISOString();
        let joined : number = 0;
        for( const invite of invites )
        {
            const existing = await this.dynamo.get<Record<string, string>>( "members", { accountId: invite.accountId, userId } );
            if( existing.ok && !existing.data )
            {
                const put = await this.dynamo.put( "members", {
                    accountId: invite.accountId, userId,
                    role:      invite.role, status: Account.MemberStatus.ACTIVE,
                    createdAt: invite.invitedAt || now,   // preserve invite chronology for landing order
                    email:     normalized, name: name || undefined,
                } );
                if( put.ok )
                {
                    joined++;
                    void this.emit( Events.Object.ACCOUNT_MEMBER, Events.Verb.CREATED, "member", userId, invite.accountId,
                        { userId, role: invite.role, status: Account.MemberStatus.ACTIVE, email: normalized, name: name || undefined, createdAt: invite.invitedAt || now }, userId );
                }
            }
            await this.dynamo.put( "invites", { ...invite, status: Account.InviteStatus.ACCEPTED, acceptedAt: now } );
            void this.emit( Events.Object.ACCOUNT_INVITE, Events.Verb.UPDATED, "invite", invite.inviteId, invite.accountId, { ...invite, status: Account.InviteStatus.ACCEPTED }, userId );
        }
        return joined;
    }

    ///////////////////////////////////////////////////////////////////////////////////////
    /** On shutdown, disconnect Kafka (the provisioning consumer's run-loop + producer) BEFORE the base
     *  closes the HTTP server — otherwise the open consumer keeps the process alive past SIGINT and the
     *  dev watcher force-kills it. */
    protected async aboutToQuit() : Promise<void>
    {
        if( this._kafka ) { try { await this._kafka.disconnect(); } catch( err ) { this.log.error( "kafka disconnect failed", err ); } }
        await super.aboutToQuit();
    }

    ///////////////////////////////////////////////////////////////////////////////////////
    protected async init() : Promise<void>
    {
        super.init();

        // Ensure the runtime config (AppConfig config/settings) exists — seed a fresh environment with
        // AccountConfig.DEFAULT so the service (and the Console Config tab) have usable defaults.
        const seeded = await this.appConfig.ensureSeeded( "config", "settings", AccountConfig.DEFAULT );
        if( seeded.ok ) this.log.info( "account config ready" );
        else this.log.warn( "account config seed failed — using DEFAULT until deployed", { error: seeded.error } );
    }
}

export namespace AccountService
{
    export enum Role
    {
        MAIN = "main",   // authed BFF — account CRUD, members, plans, subscriptions, billing ops
        READ = "read",   // read-only — lookups, entitlement resolution (scales independently)
    }

    /** Identity for `provisionPersonalAccount`. Only `userId` is required; name/email are best-effort (used
     *  for the account name + point-of-contact) and default gracefully when absent. */
    export interface ProvisionInput
    {
        userId     : string;
        email?     : string;
        firstName? : string;
        lastName?  : string;
        name?      : string;   // a display name to use when first/last aren't available (e.g. from JWT claims)
    }

    // role → its absolute port in the ACCOUNT block. The numbers live ONLY in @repo/services Ports;
    // the manifest's containerPort references the SAME constants, so the two can never drift.
    export const PORT : Record<Role, number> =
    {
        [ Role.MAIN ] : Ports.ACCOUNT.MAIN,
        [ Role.READ ] : Ports.ACCOUNT.READ,
    };
}

export default AccountService;
