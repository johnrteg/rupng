//
import { PostPasswordForgot, Email } from '@repo/api';
import { NetworkUtils } from '@repo/common';
import { RestfulEndpoint } from '@repo/endpoint';
import AuthService from '../services/AuthService';

//
// Forgot password — APP-DRIVEN reset (Cognito is a credential store only; we own the mail). Resolves the user
// for the identifier, then hands a PASSWORD_RESET notification to the email service via SQS — which mints a
// pending landing action (a TTL token) and sends a BRANDED reset link (or the bare-bones fallback when no
// template is published). The landing page collects the new password and completes the reset (Cognito
// setPassword) on consume. Enumeration-neutral: the response is `{ sent: true }` regardless of whether the
// account exists, and we only actually send when a matching user is found.
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
        const account : string = this.body!.account;

        // resolve the subject user WITHOUT revealing existence — a miss simply sends nothing
        const userId : string | undefined = await this.service.users.userIdFor( account );
        if( userId )
        {
            // hand the branded reset send to the email service (it mints the token + resolves the link)
            await this.service.sendNotification( {
                type:        Email.NotificationType.PASSWORD_RESET,
                target:      account,
                userId,
                requestedBy: userId,
                origin:      this.body?.origin,
            } );
        }

        const reply : PostPasswordForgot.Response = { sent: true };
        return { status: NetworkUtils.Status.OK, data: reply };
    }
}

export default PostPasswordForgotImpl;
