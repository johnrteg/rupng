//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";

//
// MFA — begin authenticator-app (TOTP) enrolment for the signed-in caller. Cognito associates a
// software token and returns a shared secret; the client renders `otpauthUri` as a QR code for the
// user's authenticator app (Google Authenticator, 1Password, …). Confirm with PostMfaTotpVerify.
//
//   client:
//   const endpt = new PostMfaTotpBegin();
//   const reply = await appdata.server.fetch( endpt );   // → { secret, otpauthUri }
//
export class PostMfaTotpBegin extends RestfulEndpoint<{}, {}, PostMfaTotpBegin.Response>
{
    public readonly uri      : string = PostMfaTotpBegin.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.POST;
    public readonly access   : Access.Role = Access.AccountRole.USER;   // authenticated caller
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    constructor()
    {
        super( {}, {} );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return []; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema():  RestfulEndpoint.Schema | null { return null; }
}

export namespace PostMfaTotpBegin
{
    export const URI : string = apiPath( "auth", 1, "/mfa/totp/begin" );   // /api/auth/v1/mfa/totp/begin

    export interface Response
    {
        secret     : string;   // the base32 shared secret (also encoded in otpauthUri) — for manual entry
        otpauthUri : string;   // otpauth://totp/… — render as a QR code
    }

    export enum Error
    {
        UNAUTHORIZED          = NetworkUtils.Status.UNAUTHORIZED,
        INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR,
    }
}

export default PostMfaTotpBegin;
