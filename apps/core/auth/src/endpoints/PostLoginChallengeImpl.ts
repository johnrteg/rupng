//
import { PostLoginChallenge, Login } from '@repo/api';
import { NetworkUtils } from '@repo/common';
import { RestfulEndpoint } from '@repo/endpoint';
import AuthService from '../services/AuthService';
import UserStore from '../services/UserStore';
import { authError, type AuthFailure } from './AuthErrors';

// Cognito's ChallengeName → our shared Login.ChallengeType (the wire vocabulary). Anything unmapped is
// dropped from `challenges` (the client only renders factors it understands).
const COGNITO_CHALLENGE : Record<string, Login.ChallengeType> =
{
    SMS_MFA:               Login.ChallengeType.SMS_OTP,
    EMAIL_OTP:             Login.ChallengeType.EMAIL_OTP,
    SOFTWARE_TOKEN_MFA:    Login.ChallengeType.TOTP,
    NEW_PASSWORD_REQUIRED: Login.ChallengeType.PASSWORD,
};

//
// Stepped sign-in, step 2 (challenge). PASSWORD is verified by Cognito (ADMIN_USER_PASSWORD_AUTH) and may
// itself return a further MFA challenge (e.g. an authenticator app → TOTP); TOTP answers the software-
// token MFA gate (AdminRespondToAuthChallenge) to finish signing in. Each non-terminal reply carries a
// `challengeToken` the client echoes back to answer the next factor.
//
export class PostLoginChallengeImpl extends PostLoginChallenge
{
    private service : AuthService;

    ////////////////////////////////////////////////////////////////////////////////////////////////////////////
    constructor( service : AuthService )
    {
        super();
        this.service = service;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////////////////////
    public async execute( _auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        const token : string = this.body?.challengeToken ?? "";
        const type  : Login.ChallengeType | undefined = this.body?.type;
        const value : string = this.body?.value ?? "";

        try
        {
            let loginResult : UserStore.LoginResult;
            let account     : string;

            if( type === Login.ChallengeType.PASSWORD )
            {
                account     = token;                                    // identifier-first: the token IS the account
                loginResult = await this.service.users.login( account, value );
            }
            else if( type === Login.ChallengeType.TOTP )
            {
                const flow = UserStore.unpackFlow( token );             // token packs account + Cognito Session
                if( !flow.session ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "invalid challenge token" } };
                account     = flow.account;
                loginResult = await this.service.users.respondTotp( account, flow.session, value );
            }
            else
            {
                return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: `unsupported challenge "${type}"` } };
            }

            if( loginResult.complete )
            {
                void this.service.publishLogin( this.service.subFromToken( loginResult.tokens?.accessToken ), account );   // stamps users.lastLoginAt + auth.session.created
                return { status: NetworkUtils.Status.OK, data: { complete: true, sessionToken: loginResult.tokens?.accessToken } };
            }

            // a further challenge remains (e.g. password → software-token MFA) — surface it + a continuation token
            const nextChallenge : Login.ChallengeType | undefined = loginResult.challenge ? COGNITO_CHALLENGE[ loginResult.challenge ] : undefined;
            const reply : PostLoginChallenge.Response = { complete: false, challenges: nextChallenge ? [ nextChallenge ] : [] };
            if( nextChallenge === Login.ChallengeType.TOTP && loginResult.session )
                reply.challengeToken = UserStore.packFlow( account, loginResult.session );
            return { status: NetworkUtils.Status.OK, data: reply };
        }
        catch( err )
        {
            const failure : AuthFailure = authError( err );
            return { status: failure.status, data: { message: failure.message } };
        }
    }
}

export default PostLoginChallengeImpl;
