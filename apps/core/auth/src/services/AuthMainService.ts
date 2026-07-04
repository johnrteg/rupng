//
import AuthService from './AuthService';

// read-side impls
import GetUsersImpl      from '../endpoints/GetUsersImpl';
import GetUserExistsImpl from '../endpoints/GetUserExistsImpl';
import GetUserMetaImpl   from '../endpoints/GetUserMetaImpl';
import GetSessionImpl    from '../endpoints/GetSessionImpl';
import GetSessionsImpl   from '../endpoints/GetSessionsImpl';
import GetAccountsImpl   from '../endpoints/GetAccountsImpl';
import GetPasskeysImpl   from '../endpoints/GetPasskeysImpl';
import GetApiKeysImpl    from '../endpoints/GetApiKeysImpl';
// write-side impls
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
// MAIN role — the COMBINED auth service: registers BOTH read + write endpoints in one process. This is
// what local dev + the webproxy target (/api/auth → :8110), and a simple single-task deploy. The
// reader/writer split (separate roles) is for prod scale-out; Main is the all-in-one.
//
// NOTE — the registrations are written out as explicit `new <Endpoint>Impl(this)` calls (rather than
// delegating to AuthService.register{Read,Write}Endpoints) ON PURPOSE: the console's webproxy builds its
// local /api route table by STATICALLY parsing each role-service file for `new XImpl(` tokens
// (tools/console apiTester.ts → variantBindings). If MAIN delegated to the base-class helpers, the parser
// would see no endpoints here and route nothing to :8110 → 404. So the literal `new XImpl(` calls must
// live in this role file. (Reader/Writer delegate to the shared helpers — they're prod-only and the
// parser intentionally finds no impls there, so they never compete with MAIN for the local route table.)
//
export class AuthMainService extends AuthService
{
    /////////////////////////////////////////////////////////////////////
    constructor()
    {
        super( AuthService.Role.MAIN );
    }

    /////////////////////////////////////////////////////////////////////
    protected override async registerEndpoints() : Promise<void>
    {
        await super.registerEndpoints();          // keeps /health + /version

        // reads
        this.register( new GetUsersImpl( this ) );
        this.register( new GetUserExistsImpl( this ) );
        this.register( new GetUserMetaImpl( this ) );
        this.register( new GetSessionImpl( this ) );
        this.register( new GetSessionsImpl( this ) );
        this.register( new GetAccountsImpl( this ) );
        this.register( new GetPasskeysImpl( this ) );
        this.register( new GetApiKeysImpl( this ) );

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

        // passkeys (WebAuthn)
        this.register( new PostPasskeyRegisterOptionsImpl( this ) );
        this.register( new PostPasskeyRegisterVerifyImpl( this ) );
        this.register( new PostLoginPasskeyOptionsImpl( this ) );
        this.register( new PostLoginPasskeyVerifyImpl( this ) );
        this.register( new DeletePasskeyImpl( this ) );

        // authenticator-app (TOTP) MFA enrolment
        this.register( new PostMfaTotpBeginImpl( this ) );
        this.register( new PostMfaTotpVerifyImpl( this ) );
        this.register( new DeleteMfaTotpImpl( this ) );

        // developer API keys (mint / revoke)
        this.register( new PostApiKeyImpl( this ) );
        this.register( new DeleteApiKeyImpl( this ) );

        // user metadata (writes)
        this.register( new PostUserMetaImpl( this ) );
        this.register( new DeleteUserMetaImpl( this ) );
    }
}


export default AuthMainService;
