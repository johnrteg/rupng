//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";

//
// MFA — confirm authenticator-app (TOTP) enrolment: the caller submits a 6-digit code from their app.
// On success Cognito marks the software token verified and it becomes a preferred MFA factor.
//
//   client:
//   const endpt = new PostMfaTotpVerify( { code: "123456" } );
//   const reply = await appdata.server.fetch( endpt );   // → { verified }
//
export class PostMfaTotpVerify extends RestfulEndpoint<{}, PostMfaTotpVerify.Body, PostMfaTotpVerify.Response>
{
    public readonly uri      : string = PostMfaTotpVerify.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.POST;
    public readonly access   : Access.Role = Access.AccountRole.USER;   // authenticated caller
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    constructor( body? : PostMfaTotpVerify.Body )
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
            properties: { code: { type: 'string', minLength: 6, maxLength: 6 } },
            required: [ 'code' ],
            additionalProperties: false
        };
    }
}

export namespace PostMfaTotpVerify
{
    export const URI : string = apiPath( "auth", 1, "/mfa/totp/verify" );   // /api/auth/v1/mfa/totp/verify

    export interface Body extends RestfulEndpoint.AuthRequest
    {
        code : string;   // the 6-digit code from the authenticator app
    }

    export interface Response
    {
        verified : boolean;
    }

    export enum Error
    {
        BAD_REQUEST           = NetworkUtils.Status.BAD_REQUEST,
        UNAUTHORIZED          = NetworkUtils.Status.UNAUTHORIZED,
        INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR,
    }
}

export default PostMfaTotpVerify;
