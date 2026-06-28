//
import { PostLoginChallenge, Login } from '@repo/api';
import { NetworkUtils } from '@repo/common';
import { RestfulEndpoint } from '@repo/endpoint';
import AuthService from '../services/AuthService';
import type UserStore from '../services/UserStore';
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
// Stepped sign-in, step 2 (challenge). Password challenges are verified by Cognito (ADMIN_USER_PASSWORD_AUTH)
// → a session token. Other challenge types are not yet wired.
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

        if( type !== Login.ChallengeType.PASSWORD )
            return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: `unsupported challenge "${type}"` } };

        try
        {
            const loginResult : UserStore.LoginResult = await this.service.users.login( token, value );
            const nextChallenge : Login.ChallengeType | undefined = loginResult.challenge ? COGNITO_CHALLENGE[ loginResult.challenge ] : undefined;
            const reply : PostLoginChallenge.Response = loginResult.complete
                ? { complete: true, sessionToken: loginResult.tokens?.accessToken }
                : { complete: false, challenges: nextChallenge ? [ nextChallenge ] : [] };
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
