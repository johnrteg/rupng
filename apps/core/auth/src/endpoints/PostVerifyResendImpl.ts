//
import { PostVerifyResend } from '@repo/api';
import { NetworkUtils } from '@repo/common';
import { RestfulEndpoint } from '@repo/endpoint';
import AuthService from '../services/AuthService';

//
// Resend the registration verification code (Cognito ResendConfirmationCode). Best-effort/neutral.
//
export class PostVerifyResendImpl extends PostVerifyResend
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
        try { await this.service.users.resendCode( this.body?.registrationToken ?? "" ); } catch { /* neutral */ }
        const reply : PostVerifyResend.Response = { sent: true };
        return { status: NetworkUtils.Status.OK, data: reply };
    }
}

export default PostVerifyResendImpl;
