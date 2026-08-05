//
import { PostLogin, Login } from '@repo/api';
import { NetworkUtils } from '@repo/common';
import { RestfulEndpoint } from '@repo/endpoint';
import AuthService from '../services/AuthService';
import UserStore from '../services/UserStore';
import { authError, type AuthFailure } from './AuthErrors';

//
// Single-shot sign-in (account + password) → Cognito tokens. (The stepped flow is /login/identify +
// /login/challenge; this is the one-call convenience.)
//
export class PostLoginImpl extends PostLogin
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
        try
        {
            const loginResult : UserStore.LoginResult = await this.service.users.login( this.body!.account, this.body!.password );
            let reply : PostLogin.Response;
            if( loginResult.complete )
            {
                void this.service.publishLogin( this.service.subFromToken( loginResult.tokens?.accessToken ), this.body!.account );   // stamps users.lastLoginAt + auth.session.created
                reply = { complete: true, sessionToken: loginResult.tokens?.accessToken, idToken: loginResult.tokens?.idToken, refreshToken: loginResult.tokens?.refreshToken, expiresIn: loginResult.tokens?.expiresIn };
            }
            else if( loginResult.challenge === "SOFTWARE_TOKEN_MFA" && loginResult.session )
                // authenticator-app gate: surface a TOTP challenge + an opaque token (account + Cognito
                // Session) the client echoes back to /login/challenge to finish signing in
                reply = { complete: false, challenge: Login.ChallengeType.TOTP, challengeToken: UserStore.packFlow( this.body!.account, loginResult.session ) };
            else
                reply = { complete: false, challenge: loginResult.challenge };
            return { status: NetworkUtils.Status.OK, data: reply };
        }
        catch( err )
        {
            const failure : AuthFailure = authError( err );
            // Unexpected (500) failures are otherwise collapsed to a generic message with no trace — log the
            // real exception so a misconfiguration (missing USERPOOL_USERS, no app client, auth-flow not
            // enabled, …) is visible instead of an opaque 500.
            if( failure.status === NetworkUtils.Status.INTERNAL_SERVER_ERROR )
                this.service.log.error( "PostLogin failed", {
                    name:    ( err as { name? : string } )?.name,
                    message: ( err as { message? : string } )?.message,
                } );
            return { status: failure.status, data: { message: failure.message } };
        }
    }
}

export default PostLoginImpl;
