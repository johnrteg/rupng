//
import { PostLogin } from '@repo/api';
import { NetworkUtils } from '@repo/common';
import { RestfulEndpoint } from '@repo/endpoint';
import AuthService from '../services/AuthService';
import type UserStore from '../services/UserStore';
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
            const reply : PostLogin.Response = loginResult.complete
                ? { complete: true, sessionToken: loginResult.tokens?.accessToken, idToken: loginResult.tokens?.idToken, refreshToken: loginResult.tokens?.refreshToken, expiresIn: loginResult.tokens?.expiresIn }
                : { complete: false, challenge: loginResult.challenge };
            return { status: NetworkUtils.Status.OK, data: reply };
        }
        catch( err )
        {
            const failure : AuthFailure = authError( err );
            return { status: failure.status, data: { message: failure.message } };
        }
    }
}

export default PostLoginImpl;
