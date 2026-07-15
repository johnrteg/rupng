//
import { PostPasswordReset } from '@repo/api';
import { NetworkUtils } from '@repo/common';
import { RestfulEndpoint } from '@repo/endpoint';
import AuthService from '../services/AuthService';
import { authError, type AuthFailure } from './AuthErrors';

//
// Reset password — complete a Cognito reset with the code + new password.
//
export class PostPasswordResetImpl extends PostPasswordReset
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
            await this.service.users.resetPassword( this.body!.account, this.body!.code, this.body!.password );
            const reply : PostPasswordReset.Response = { ok: true };
            return { status: NetworkUtils.Status.OK, data: reply };
        }
        catch( err )
        {
            const failure : AuthFailure = authError( err );
            return { status: failure.status, data: { message: failure.message } };
        }
    }
}

export default PostPasswordResetImpl;
