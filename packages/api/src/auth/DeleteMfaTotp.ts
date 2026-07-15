//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";

//
// MFA — disable the authenticator app (TOTP) for the signed-in caller. Turns off the software-token MFA
// preference in Cognito so it's no longer required at sign-in. Re-enrolling later starts a fresh secret
// (PostMfaTotpBegin). The client sends its access token as `Authorization: Bearer <token>`.
//
//   client:
//   const endpt = new DeleteMfaTotp();
//   const reply = await appdata.server.fetch( endpt );   // → { disabled }
//
export class DeleteMfaTotp extends RestfulEndpoint<{}, undefined, DeleteMfaTotp.Response>
{
    public readonly uri      : string = DeleteMfaTotp.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.DELETE;
    public readonly access   : Access.Role = Access.AccountRole.USER;   // authenticated caller
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    constructor()
    {
        super( {} );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return []; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema():  RestfulEndpoint.Schema | null { return null; }
}

export namespace DeleteMfaTotp
{
    export const URI : string = apiPath( "auth", 1, "/mfa/totp" );   // /api/auth/v1/mfa/totp

    export interface Response
    {
        disabled : boolean;
    }

    export enum Error
    {
        UNAUTHORIZED          = NetworkUtils.Status.UNAUTHORIZED,
        INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR,
    }
}

export default DeleteMfaTotp;
