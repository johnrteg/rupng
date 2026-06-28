//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";

//
// Sign-up — submit the emailed/texted verification code for a registration. On success the pending
// account is activated and a session is issued. Carries the `registrationToken` from /register.
//
//   client:
//   const endpt = new PostRegisterVerify( { registrationToken, code } );
//
export class PostRegisterVerify extends RestfulEndpoint<{}, PostRegisterVerify.Body, PostRegisterVerify.Response>
{
    public readonly uri      : string = PostRegisterVerify.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.POST;
    public readonly access   : Access.Role | undefined = undefined;   // non-authenticated
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    constructor( body? : PostRegisterVerify.Body )
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
                registrationToken: { type: 'string', minLength: 1 },
                code:              { type: 'string', minLength: 1, maxLength: 12 }
            },
            required: ['registrationToken', 'code'],
            additionalProperties: false
        };
    }
}

export namespace PostRegisterVerify
{
    export const URI : string = apiPath( "auth", 1, "/register/verify" );   // /api/auth/v1/register/verify

    export interface Body extends RestfulEndpoint.NonAuthRequest
    {
        registrationToken : string;
        code              : string;
    }

    export interface Response
    {
        complete      : boolean;    // true → account activated
        sessionToken? : string;     // present when complete (auto sign-in)
    }

    export enum Error
    {
        BAD_REQUEST           = NetworkUtils.Status.BAD_REQUEST,
        UNAUTHORIZED          = NetworkUtils.Status.UNAUTHORIZED,   // wrong/expired code
        INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR,
    }
}

export default PostRegisterVerify;
