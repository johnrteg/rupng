//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";

//
// Sign-up — PHONE verification during registration. With no `code`, (re)sends an SMS code to the
// given phone; with a `code`, confirms it. Lets a registration started by email add/verify a phone,
// or a phone-method registration confirm its number. Carries the `registrationToken` from /register.
//
//   client (send):    new PostVerifyPhone( { registrationToken, phone } )
//   client (confirm): new PostVerifyPhone( { registrationToken, phone, code } )
//
export class PostVerifyPhone extends RestfulEndpoint<{}, PostVerifyPhone.Body, PostVerifyPhone.Response>
{
    public readonly uri      : string = PostVerifyPhone.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.POST;
    public readonly access   : Access.Role | undefined = undefined;   // non-authenticated
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    constructor( body? : PostVerifyPhone.Body )
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
            properties: {
                registrationToken: { type: 'string' },
                phone:             { type: 'string' },   // E.164
                code:              { type: 'string' }     // omit to send; provide to confirm
            },
            required: ['registrationToken', 'phone'],
            additionalProperties: false
        };
    }
}

export namespace PostVerifyPhone
{
    export const URI : string = apiPath( "auth", 1, "/verify/phone" );   // /api/auth/v1/verify/phone

    export interface Body extends RestfulEndpoint.NonAuthRequest
    {
        registrationToken : string;
        phone             : string;   // E.164
        code?             : string;   // present → confirm; absent → (re)send
    }

    export interface Response
    {
        sent?     : boolean;    // a code was sent (no `code` supplied)
        verified? : boolean;    // the supplied code matched
    }

    export enum Error
    {
        BAD_REQUEST           = NetworkUtils.Status.BAD_REQUEST,
        UNAUTHORIZED          = NetworkUtils.Status.UNAUTHORIZED,   // wrong/expired code
        TOO_MANY_REQUESTS     = NetworkUtils.Status.TOO_MANY_REQUESTS,
        INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR,
    }
}

export default PostVerifyPhone;
