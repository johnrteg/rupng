//
import { PostRegister, PostVerifyResend, Email } from '@repo/api';
import { NetworkUtils } from '@repo/common';
import { RestfulEndpoint } from '@repo/endpoint';
import AuthService from '../services/AuthService';

//
// Resend the registration verification — APP-DRIVEN: re-mint + re-send the BRANDED email-verification link
// (a fresh AuthAction) for the identifier. Best-effort / enumeration-neutral (always reports sent; a miss
// simply sends nothing). The prior AuthAction TTL-expires on its own; a new token is issued each resend.
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
        const account : string = this.body?.registrationToken ?? "";   // the registration token IS the identifier

        // resolve the subject without leaking existence — a miss sends nothing but still reports sent
        const userId : string | undefined = account !== "" ? await this.service.users.userIdFor( account ) : undefined;
        if( userId )
            await this.service.sendNotification( {
                type:        Email.NotificationType.EMAIL_VERIFICATION,
                target:      account,
                userId,
                requestedBy: userId,
                origin:      this.body?.origin,
            } );

        const reply : PostVerifyResend.Response = {
            sent: true,
            codeExpiresInSec: PostRegister.CODE_EXPIRES_SEC, resendCooldownSec: PostRegister.RESEND_COOLDOWN_SEC,
        };
        return { status: NetworkUtils.Status.OK, data: reply };
    }
}

export default PostVerifyResendImpl;
