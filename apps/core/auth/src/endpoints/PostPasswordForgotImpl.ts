//
import { PostPasswordForgot } from '@repo/api';
import { NetworkUtils } from '@repo/common';
import { RestfulEndpoint } from '@repo/endpoint';
import AuthService from '../services/AuthService';

//
// Forgot password — start a Cognito reset. Enumeration-neutral: always reports sent (errors swallowed).
//
export class PostPasswordForgotImpl extends PostPasswordForgot
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
        try { await this.service.users.forgotPassword( this.body!.account ); } catch { /* neutral */ }
        const reply : PostPasswordForgot.Response = { sent: true };
        return { status: NetworkUtils.Status.OK, data: reply };
    }
}

export default PostPasswordForgotImpl;
