//

import { Application, Service, Ports, Register, Cognito, Dynamo, Kafka, Sqs, Events } from "@repo/services";

import type { Type } from "@repo/common";

import { AuthConfig, AuthAction, Email, Notification } from "@repo/api";

import UserStore from "./UserStore";
import PasskeyStore from "./PasskeyStore";
import ApiKeyStore from "./ApiKeyStore";
import ActionStore from "./ActionStore";

// read-side endpoint impls
import GetUsersImpl      from '../endpoints/GetUsersImpl';
import GetUserExistsImpl from '../endpoints/GetUserExistsImpl';
import GetUserMetaImpl   from '../endpoints/GetUserMetaImpl';
import GetSessionImpl    from '../endpoints/GetSessionImpl';
import GetSessionsImpl   from '../endpoints/GetSessionsImpl';
import GetAccountsImpl   from '../endpoints/GetAccountsImpl';
import GetPasskeysImpl   from '../endpoints/GetPasskeysImpl';
import GetApiKeysImpl    from '../endpoints/GetApiKeysImpl';

// write-side endpoint impls (stepped sign-in, registration, sessions, password reset, passkeys, metadata)
import PostLoginIdentifyImpl        from '../endpoints/PostLoginIdentifyImpl';
import PostLoginChallengeImpl       from '../endpoints/PostLoginChallengeImpl';
import PostLoginChallengeResendImpl from '../endpoints/PostLoginChallengeResendImpl';
import PostRegisterImpl             from '../endpoints/PostRegisterImpl';
import PostRegisterVerifyImpl       from '../endpoints/PostRegisterVerifyImpl';
import PostVerifyResendImpl         from '../endpoints/PostVerifyResendImpl';
import PostVerifyPhoneImpl          from '../endpoints/PostVerifyPhoneImpl';
import PostUserMetaImpl             from '../endpoints/PostUserMetaImpl';
import DeleteUserMetaImpl           from '../endpoints/DeleteUserMetaImpl';
import PostLoginImpl                from '../endpoints/PostLoginImpl';
import DeleteSessionImpl            from '../endpoints/DeleteSessionImpl';
import PostPasswordForgotImpl       from '../endpoints/PostPasswordForgotImpl';
import PostPasswordResetImpl        from '../endpoints/PostPasswordResetImpl';
import PostSessionRefreshImpl       from '../endpoints/PostSessionRefreshImpl';
import PostSessionSwitchImpl        from '../endpoints/PostSessionSwitchImpl';
import DeleteSessionByIdImpl        from '../endpoints/DeleteSessionByIdImpl';
import PostSessionsRevokeAllImpl    from '../endpoints/PostSessionsRevokeAllImpl';
import PostPasskeyRegisterOptionsImpl from '../endpoints/PostPasskeyRegisterOptionsImpl';
import PostPasskeyRegisterVerifyImpl  from '../endpoints/PostPasskeyRegisterVerifyImpl';
import PostLoginPasskeyOptionsImpl    from '../endpoints/PostLoginPasskeyOptionsImpl';
import PostLoginPasskeyVerifyImpl     from '../endpoints/PostLoginPasskeyVerifyImpl';
import DeletePasskeyImpl              from '../endpoints/DeletePasskeyImpl';
import PostMfaTotpBeginImpl           from '../endpoints/PostMfaTotpBeginImpl';
import PostMfaTotpVerifyImpl          from '../endpoints/PostMfaTotpVerifyImpl';
import DeleteMfaTotpImpl              from '../endpoints/DeleteMfaTotpImpl';
import PostApiKeyImpl                 from '../endpoints/PostApiKeyImpl';
import DeleteApiKeyImpl               from '../endpoints/DeleteApiKeyImpl';

//
// common auth server base
//
export class AuthService extends Service
{
    // name/version of this app, read from apps/auth/package.json at startup
    protected pkg : Application.PackageInfo;

    // AWS facades this service owns (resolved lazily against this service's CloudManifest):
    //   • Cognito — the credential authority (user pool "users")
    //   • Dynamo  — the auth tables (users / user_identities / sessions / … see CloudManifest)
    private _cognito?  : Cognito;
    private _dynamo?   : Dynamo;
    private _kafka?    : Kafka;
    private _sqs?      : Sqs;
    private _users?    : UserStore;
    private _passkeys? : PasskeyStore;
    private _apiKeys?  : ApiKeyStore;
    private _actions?  : ActionStore;

    // maps a transactional notification case to the landing ACTION type it mints (the enums share string values
    // but are distinct closed sets — this is the single crossing point between them)
    private static readonly ACTION_TYPE : Partial<Record<Email.NotificationType, AuthAction.Type>> =
    {
        [ Email.NotificationType.EMAIL_VERIFICATION ]: AuthAction.Type.EMAIL_VERIFICATION,
        [ Email.NotificationType.PASSWORD_RESET ]:     AuthAction.Type.PASSWORD_RESET,
        [ Email.NotificationType.MFA_CODE ]:           AuthAction.Type.MFA_CODE,
        [ Email.NotificationType.ACCOUNT_INVITE ]:     AuthAction.Type.ACCOUNT_INVITE,
    };

    ///////////////////////////////////////////////////////////////////////////////////////
    /** The EMAIL service's send-queue URL — auth posts transactional sends here. Env-overridable
     *  (`EMAIL_SEND_QUEUE_URL`); defaults to the local LocalStack send queue for dev. */
    private static emailSendQueueUrl() : string
    {
        return process.env.EMAIL_SEND_QUEUE_URL ?? "http://sqs.us-east-1.localhost.localstack.cloud:4566/000000000000/local-email-queue-email-send";
    }

    ///////////////////////////////////////////////////////////////////////////////////////
    constructor( role : AuthService.Role )
    {
        // identity = Register.Service.AUTH (+ role → "auth:reader"); default to this role's port in the AUTH
        // block for local dev; a deploy's env PORT overrides it
        super( Register.Service.AUTH, role, AuthService.PORT[ role ] );

        // __dirname resolves to apps/auth/bin/services at runtime; loadPackageInfo walks up
        // to the nearest package.json (apps/auth/package.json)
        this.pkg = this.loadPackageInfo( __dirname );
        this.log.info( "version", { name: this.pkg.name, version: this.pkg.version } );
    }

    ///////////////////////////////////////////////////////////////////////////////////////
    /** Cognito facade — user-pool admin/auth ops (pool key "users"). Lazy + cached. */
    public get cognito() : Cognito { return this._cognito ??= new Cognito( this.cloud ); }

    /** Dynamo facade — the auth tables (keyed by the logical table keys in CloudManifest). Lazy + cached. */
    public get dynamo() : Dynamo { return this._dynamo ??= new Dynamo( this.cloud ); }

    /** Kafka facade — publishes auth entity events (e.g. auth.user.created). Lazy + cached. */
    public get kafka() : Kafka { return this._kafka ??= new Kafka( this.cloud ); }

    /** SQS facade — auth drops transactional SEND requests on the email service's send queue (app-driven mail —
     *  verification / reset links go out branded via the email service, not Cognito). Lazy + cached. */
    public get sqs() : Sqs { return this._sqs ??= new Sqs( this.cloud ); }

    ///////////////////////////////////////////////////////////////////////////////////////
    /** Publish an `auth.*` lifecycle event (events dictionary). Best-effort — a bus miss is logged, never
     *  fails the request. Identity-centric: `accountId` scopes by the acting account when known, else the
     *  userId (no account context at login/registration). `actorUserId` (if given) makes it USER-actored. */
    public async emit( object : Events.Object, verb : Events.Verb, targetType : string, targetId : string, accountId : string, data : unknown, actorUserId? : string ) : Promise<void>
    {
        const env : Events.Envelope = Events.envelope( { object, verb, accountId, target: { type: targetType, id: targetId }, data, actorUserId } );
        const published = await this.kafka.publishEvent( env );
        if( !published.ok ) this.log.warn( "auth event publish failed", { action: env.action, targetId, error: published.error } );
    }

    ///////////////////////////////////////////////////////////////////////////////////////
    /** Publish `auth.user.created` — the account service consumes it to provision the account + membership,
     *  then emits `account.account.created`. In the APP-DRIVEN sign-up flow this fires at REGISTER (the account
     *  exists immediately; the branded verification link then confirms the email), not at verification. Best-
     *  effort: no account exists yet, so the tenant scope is the userId. */
    public async publishUserCreated( user : AuthService.CreatedUser ) : Promise<void>
    {
        if( !user.userId ) return;
        await this.emit( Events.Object.AUTH_USER, Events.Verb.CREATED, "user", user.userId, user.userId, user, user.userId );
    }

    ///////////////////////////////////////////////////////////////////////////////////////
    /** A LOGIN, from ANY path (password / passkey / MFA). Stamps this user's own `users.lastLoginAt`
     *  (universal — regardless of which account, if any, they go on to act as), then publishes
     *  `auth.session.created` for any OTHER service that wants to react to a login. Best-effort — a
     *  failed stamp is logged, never thrown. No acting account at login → scope the event by userId. */
    public async publishLogin( userId : string, username? : string ) : Promise<void>
    {
        if( !userId ) return;
        const stamped : Type.Result<void> = await this.users.touchLogin( userId );
        if( !stamped.ok ) this.log.warn( "lastLoginAt stamp failed", { userId, error: stamped.error } );
        await this.emit( Events.Object.AUTH_SESSION, Events.Verb.CREATED, "session", userId, userId, { userId, username, at: new Date().toISOString() }, userId );
        // action-level audit trail (apps/core/audit/SPECS.md) — same scoping choice as the Kafka emit above
        // (no acting account at login, so the userId scopes the trail); best-effort, never throws.
        await this.audit( { action: Events.actionOf( Events.Object.AUTH_SESSION, Events.Verb.CREATED ), accountId: userId, target: { type: "session", id: userId }, actorUserId: userId, context: { username: username ?? "" } } );
    }

    ///////////////////////////////////////////////////////////////////////////////////////
    /** The `sub` (userId) from an access token's payload — decode-only (no verification; the token was just
     *  minted). Used so a login event can carry the userId regardless of which flow issued the token. */
    public subFromToken( accessToken? : string ) : string
    {
        try
        {
            const payload : string | undefined = accessToken?.split( "." )[ 1 ];
            if( !payload ) return "";
            const claims = JSON.parse( Buffer.from( payload, "base64url" ).toString( "utf8" ) ) as { sub? : string; username? : string };
            return String( claims.sub ?? claims.username ?? "" );
        }
        catch { return ""; }
    }

    /** On shutdown, disconnect the Kafka producer/consumers BEFORE the base closes the HTTP server —
     *  open broker connections (and any consumer run-loop) otherwise keep the process alive, so it lingers
     *  past SIGINT and the dev watcher has to force-kill it. */
    protected async aboutToQuit() : Promise<void>
    {
        if( this._kafka ) { try { await this._kafka.disconnect(); } catch( err ) { this.log.error( "kafka disconnect failed", err ); } }
        await super.aboutToQuit();
    }

    /** UserStore — the auth data layer (Cognito credentials + DynamoDB metadata). Lazy + cached. */
    public get users() : UserStore { return this._users ??= new UserStore( this.cognito, this.dynamo ); }

    /** PasskeyStore — WebAuthn (FIDO2) ceremonies + credential storage. Lazy + cached. */
    public get passkeys() : PasskeyStore { return this._passkeys ??= new PasskeyStore( this.dynamo ); }

    /** ApiKeyStore — developer API key mint/list/revoke (the `api_keys` table). Lazy + cached. */
    public get apiKeys() : ApiKeyStore { return this._apiKeys ??= new ApiKeyStore( this.dynamo ); }

    /** ActionStore — no-auth landing-action TTL queue (the `auth_actions` table). Lazy + cached. */
    public get actions() : ActionStore { return this._actions ??= new ActionStore( this.dynamo ); }

    ///////////////////////////////////////////////////////////////////////////////////////
    /** Send a transactional NOTIFICATION (verification / reset / MFA / invite / …) the APP-DRIVEN way — the app
     *  owns the mail, not Cognito. For a case that needs a landing token (`Notification.SPEC[type].createsAction`)
     *  this mints a pending `AuthAction` and substitutes its resolved URL into the matching merge token, then drops
     *  an `Email.SendRequest` on the EMAIL service's send queue. The email worker renders the published template
     *  for the case, or `Notification.fallbackFor` if none is published — so something always goes out.
     *
     *  Best-effort + fail-CLOSED on the link: if the action can't be minted we DON'T send (a verification/reset
     *  mail with a dead link is worse than none); a queue failure is logged, never thrown (callers stay
     *  enumeration-neutral). Links are PATHS resolved to a full URL here at send time (origin → env → localhost),
     *  so local dev, prod, and white-label all work. */
    public async sendNotification( input : AuthService.NotifyInput ) : Promise<void>
    {
        // start from the caller's merge data; the action URL (if any) is layered on below
        const mergeData : Record<string, unknown> = { ...( input.mergeData ?? {} ) };

        // mint the landing ACTION for cases that need one, and fill its URL into the case's merge token
        const spec : Notification.Spec | undefined = Notification.specFor( input.type );
        const actionType : AuthAction.Type | undefined = AuthService.ACTION_TYPE[ input.type ];
        if( spec?.createsAction && actionType !== undefined )
        {
            const minted : Type.Result<AuthAction.Entity> = await this.actions.create( {
                type:        actionType,
                target:      input.target,
                accountId:   input.accountId,
                userId:      input.userId,
                requestedBy: input.requestedBy,
                ttlMinutes:  spec.actionTtlMinutes,
                params:      input.params,
            } );
            // fail closed — a link that won't validate is worse than sending nothing
            if( !minted.ok ) { this.log.warn( "notification action mint failed — not sending", { type: input.type, error: minted.error } ); return; }

            const base : string = this.landingBaseUrl( input.origin );
            const url : string = AuthAction.urlFor( base, actionType, minted.data.actionId );
            const token : string = spec.mergeToken ?? AuthAction.MERGE_TOKEN[ actionType ] ?? "action_url";
            mergeData[ token ] = url;
        }

        // hand the send to the email service (its worker resolves template-or-fallback + the system sender)
        const request : Email.SendRequest =
        {
            to:               [ { email: input.target } ],
            accountId:        input.accountId,
            notificationType: input.type,
            mergeData,
        };
        const queueUrl : string = AuthService.emailSendQueueUrl();
        this.log.info( "notification enqueue", { type: input.type, target: input.target, queueUrl, endpoint: process.env.AWS_ENDPOINT_URL ?? "(default)" } );
        const enqueued : Type.Result<void> = await this.sqs.sendToUrl( queueUrl, { request } );
        if( enqueued.ok ) this.log.info( "notification enqueued OK", { type: input.type } );
        else this.log.warn( "notification enqueue failed", { type: input.type, error: enqueued.error } );
    }

    ///////////////////////////////////////////////////////////////////////////////////////
    /** Resolve the base URL (protocol + host) that a landing PATH is appended to. The request origin the user
     *  came from wins (white-label / local alike); else a per-env config env var; else the local web dev server. */
    private landingBaseUrl( origin? : string ) : string
    {
        return origin ?? process.env.PUBLIC_BASE_URL ?? "http://localhost:5173";
    }

    ///////////////////////////////////////////////////////////////////////////////////////
    protected async init() : Promise<void>
    {
        super.init();

        // Ensure the runtime config (AppConfig config/settings) exists — seed a fresh environment with
        // AuthConfig.DEFAULT so the service (and the Console Config tab) have usable defaults without a
        // manual step. Idempotent: returns the live value once seeded.
        const seeded = await this.appConfig.ensureSeeded( "config", "settings", AuthConfig.DEFAULT );
        if( seeded.ok ) this.log.info( "auth config ready" );
        else this.log.warn( "auth config seed failed — using DEFAULT until deployed", { error: seeded.error } );
    }

    ///////////////////////////////////////////////////////////////////////////////////////
    // The read-only auth lookups. The Reader role registers these alone; the Main (combined, local/dev)
    // role registers them alongside the writes. (The read/write SPLIT exists for prod scale-out.)
    protected registerReadEndpoints() : void
    {
        this.register( new GetUsersImpl( this ) );
        this.register( new GetUserExistsImpl( this ) );
        this.register( new GetUserMetaImpl( this ) );
        this.register( new GetSessionImpl( this ) );
        this.register( new GetSessionsImpl( this ) );
        this.register( new GetAccountsImpl( this ) );
        this.register( new GetPasskeysImpl( this ) );
        this.register( new GetApiKeysImpl( this ) );
    }

    ///////////////////////////////////////////////////////////////////////////////////////
    // The mutating auth flows (stepped sign-in → session, registration + verification, sessions,
    // password reset, passkeys, metadata writes). The Writer role registers these alone; Main combines.
    protected registerWriteEndpoints() : void
    {
        // stepped sign-in
        this.register( new PostLoginIdentifyImpl( this ) );
        this.register( new PostLoginChallengeImpl( this ) );
        this.register( new PostLoginChallengeResendImpl( this ) );

        // sign-up + verification
        this.register( new PostRegisterImpl( this ) );
        this.register( new PostRegisterVerifyImpl( this ) );
        this.register( new PostVerifyResendImpl( this ) );
        this.register( new PostVerifyPhoneImpl( this ) );

        // single-shot sign-in + sessions
        this.register( new PostLoginImpl( this ) );
        this.register( new DeleteSessionImpl( this ) );

        // password reset
        this.register( new PostPasswordForgotImpl( this ) );
        this.register( new PostPasswordResetImpl( this ) );

        // session management (refresh / switch / revoke)
        this.register( new PostSessionRefreshImpl( this ) );
        this.register( new PostSessionSwitchImpl( this ) );
        this.register( new DeleteSessionByIdImpl( this ) );
        this.register( new PostSessionsRevokeAllImpl( this ) );

        // passkeys (WebAuthn) — enrolment (authed) + sign-in (public)
        this.register( new PostPasskeyRegisterOptionsImpl( this ) );
        this.register( new PostPasskeyRegisterVerifyImpl( this ) );
        this.register( new PostLoginPasskeyOptionsImpl( this ) );
        this.register( new PostLoginPasskeyVerifyImpl( this ) );
        this.register( new DeletePasskeyImpl( this ) );

        // authenticator-app (TOTP) MFA enrolment
        this.register( new PostMfaTotpBeginImpl( this ) );
        this.register( new PostMfaTotpVerifyImpl( this ) );
        this.register( new DeleteMfaTotpImpl( this ) );

        // developer API keys (mint / revoke) — the list is a read endpoint
        this.register( new PostApiKeyImpl( this ) );
        this.register( new DeleteApiKeyImpl( this ) );

        // user metadata (writes)
        this.register( new PostUserMetaImpl( this ) );
        this.register( new DeleteUserMetaImpl( this ) );
    }
}

export namespace AuthService
{
    /** The new-user profile carried on `auth.user.created` (what the account service provisions from). */
    export interface CreatedUser
    {
        userId      : string;
        email?      : string;
        phone?      : string;
        firstName   : string;
        lastName    : string;
        accountName : string;
    }

    /** The inputs to {@link AuthService.sendNotification} — the case, who/where it goes to, and the request
     *  origin used to resolve landing links to a full URL at send time. */
    export interface NotifyInput
    {
        type         : Email.NotificationType;
        target       : string;                       // the recipient email the notification is sent to
        userId?      : string;                       // the subject user (attached to the minted action, if any)
        accountId?   : string;                       // scopes template resolution (white-label override) + the action
        requestedBy? : string;                       // the actor who triggered it (audit)
        origin?      : string;                       // the request origin → base URL for landing links
        mergeData?   : Record<string, unknown>;      // extra merge values (the action URL is layered on top)
        params?      : Record<string, string>;       // action-specific params carried on the minted action
    }

    export enum Role
    {
        MAIN = "main",
        READER = "reader",
        WRITER = "writer"
    }

    // role → its absolute port in the AUTH block. The numbers live ONLY in @repo/services Ports;
    // any manifest containerPort references the SAME constants, so the two can never drift.
    export const PORT : Record<Role, number> =
    {
        [ Role.MAIN ] : Ports.AUTH.MAIN,
        [ Role.READER ] : Ports.AUTH.READER,
        [ Role.WRITER ] : Ports.AUTH.WRITER,
    };
}

export default AuthService;