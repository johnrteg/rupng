//
import { PostRegister, ContactMethod } from '@repo/api';
import { NetworkUtils } from '@repo/common';
import { RestfulEndpoint } from '@repo/endpoint';
import AuthService from '../services/AuthService';
import type UserStore from '../services/UserStore';
import { authError, type AuthFailure } from './AuthErrors';
import { verifyBotToken } from './BotCheck';

//
// Create the pending account: Cognito SignUp (sends the verification code) + a DynamoDB `users` row.
// Enumeration-neutral — an already-registered identifier returns the SAME acknowledgement (the truthful
// "you already have an account" is emailed to the owner out-of-band, never surfaced here).
//
export class PostRegisterImpl extends PostRegister
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
        const body : PostRegister.Body = this.body!;
        const account : string = body.account;
        const verify  : ContactMethod = body.method;   // the channel a code was (or would be) sent to

        try
        {
            const registered : UserStore.Registered = await this.service.users.register( {
                method: body.method, account, firstName: body.firstName, lastName: body.lastName, accountName: body.accountName, password: body.password,
            } );
            const reply : PostRegister.Response = {
                registrationToken: account, verify: registered.verify,
                codeExpiresInSec: PostRegister.CODE_EXPIRES_SEC, resendCooldownSec: PostRegister.RESEND_COOLDOWN_SEC,
            };
            return { status: NetworkUtils.Status.OK, data: reply };
        }
        catch( err )
        {
            const failure : AuthFailure = authError( err );
            // already-exists handling. DEFAULT is enumeration-neutral: return a reply byte-for-byte identical
            // to success so an existing identifier is indistinguishable from a new one. We ONLY surface the
            // truthful "already registered" once the caller has passed the anti-bot check (proven human) —
            // which keeps mass enumeration off the open surface. verifyBotToken fails closed (no token / no
            // provider wired → neutral), so this can never leak in a real environment until CAPTCHA is live.
            if( failure.status === NetworkUtils.Status.CONFLICT )
            {
                if( await verifyBotToken( body.botToken ) )
                    return { status: NetworkUtils.Status.CONFLICT, data: { message: "An account already exists for this email or phone. Please sign in instead." } };

                const reply : PostRegister.Response = {
                    registrationToken: account, verify,
                    codeExpiresInSec: PostRegister.CODE_EXPIRES_SEC, resendCooldownSec: PostRegister.RESEND_COOLDOWN_SEC,
                };
                return { status: NetworkUtils.Status.OK, data: reply };
            }
            // Unexpected (500) failures are otherwise collapsed to a generic message with no trace — log
            // the real exception here so a misconfiguration (e.g. a missing resource identifier) is visible.
            if( failure.status === NetworkUtils.Status.INTERNAL_SERVER_ERROR )
                this.service.log.error( "PostRegister failed", {
                    name:    ( err as { name? : string } )?.name,
                    message: ( err as { message? : string } )?.message,
                } );
            return { status: failure.status, data: { message: failure.message } };
        }
    }
}

export default PostRegisterImpl;
