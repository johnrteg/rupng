//

import { Application, Service, Ports, Register, Cognito, Dynamo, Kafka } from "@repo/services";

import { AuthConfig } from "@repo/api";

import UserStore from "./UserStore";
import PasskeyStore from "./PasskeyStore";

// read-side endpoint impls
import GetUsersImpl      from '../endpoints/GetUsersImpl';
import GetUserExistsImpl from '../endpoints/GetUserExistsImpl';
import GetUserMetaImpl   from '../endpoints/GetUserMetaImpl';
import GetSessionImpl    from '../endpoints/GetSessionImpl';
import GetSessionsImpl   from '../endpoints/GetSessionsImpl';
import GetAccountsImpl   from '../endpoints/GetAccountsImpl';
import GetPasskeysImpl   from '../endpoints/GetPasskeysImpl';

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
    private _users?    : UserStore;
    private _passkeys? : PasskeyStore;

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

    /** UserStore — the auth data layer (Cognito credentials + DynamoDB metadata). Lazy + cached. */
    public get users() : UserStore { return this._users ??= new UserStore( this.cognito, this.dynamo ); }

    /** PasskeyStore — WebAuthn (FIDO2) ceremonies + credential storage. Lazy + cached. */
    public get passkeys() : PasskeyStore { return this._passkeys ??= new PasskeyStore( this.dynamo ); }

    ///////////////////////////////////////////////////////////////////////////////////////
    protected async init() : Promise<void>
    {
        super.init();

        // Ensure the runtime config (AppConfig config/settings) exists — seed a fresh environment with
        // AuthConfig.SEED so the service (and the Console Config tab) have usable defaults without a
        // manual step. Idempotent: returns the live value once seeded.
        const seeded = await this.appConfig.ensureSeeded( "config", "settings", AuthConfig.SEED );
        if( seeded.ok ) this.log.info( "auth config ready" );
        else this.log.warn( "auth config seed failed — using SEED until deployed", { error: seeded.error } );
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

        // user metadata (writes)
        this.register( new PostUserMetaImpl( this ) );
        this.register( new DeleteUserMetaImpl( this ) );
    }
}

export namespace AuthService
{
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