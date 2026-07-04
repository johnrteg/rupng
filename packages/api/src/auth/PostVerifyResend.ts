//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";

//
// Sign-up — RESEND the contact-verification code (email or SMS) for an in-progress registration.
// Carries the `registrationToken` from /register.
//
//   client:
//   const endpt = new PostVerifyResend( { registrationToken } );
//
export class PostVerifyResend extends RestfulEndpoint<{}, PostVerifyResend.Body, PostVerifyResend.Response>
{
    public readonly uri      : string = PostVerifyResend.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.POST;
    public readonly access   : Access.Role | undefined = undefined;   // non-authenticated
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    constructor( body? : PostVerifyResend.Body )
    {
        super( {}, body );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return []; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }

    public getBodySchema(): RestfulEndpoint.Schema | null
    {
        return {
            type: 'object',
            properties: { registrationToken: { type: 'string' } },
            required: ['registrationToken'],
            additionalProperties: false
        };
    }
}

export namespace PostVerifyResend
{
    export const URI : string = apiPath( "auth", 1, "/verify/resend" );   // /api/auth/v1/verify/resend

    export interface Body extends RestfulEndpoint.NonAuthRequest
    {
        registrationToken : string;
    }

    export interface Response
    {
        sent              : boolean;
        codeExpiresInSec  : number;   // validity of the freshly-resent code (resets the verify-screen expiry countdown)
        resendCooldownSec : number;   // seconds before "Resend code" re-enables again
    }

    export enum Error
    {
        BAD_REQUEST           = NetworkUtils.Status.BAD_REQUEST,
        TOO_MANY_REQUESTS     = NetworkUtils.Status.TOO_MANY_REQUESTS,
        INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR,
    }
}

export default PostVerifyResend;
