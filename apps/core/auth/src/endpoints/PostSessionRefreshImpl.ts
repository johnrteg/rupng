//
import { PostSessionRefresh } from '@repo/api';
import { NetworkUtils } from '@repo/common';
import { RestfulEndpoint } from '@repo/endpoint';
import AuthService from '../services/AuthService';
import type UserStore from '../services/UserStore';
import { authError, type AuthFailure } from './AuthErrors';

//
// Rotate the refresh token → a new access token (Cognito REFRESH_TOKEN_AUTH).
//
export class PostSessionRefreshImpl extends PostSessionRefresh
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
            const tokens : UserStore.Tokens = await this.service.users.refresh( this.body!.refreshToken );
            const reply : PostSessionRefresh.Response = { sessionToken: tokens.accessToken, expiresIn: tokens.expiresIn };
            return { status: NetworkUtils.Status.OK, data: reply };
        }
        catch( err )
        {
            const failure : AuthFailure = authError( err );
            return { status: failure.status, data: { message: failure.message } };
        }
    }
}

export default PostSessionRefreshImpl;
