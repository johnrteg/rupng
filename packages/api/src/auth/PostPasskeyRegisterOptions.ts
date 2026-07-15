//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";

//
// Begin passkey (WebAuthn) ENROLMENT for the signed-in user → creation options for the browser
// (`navigator.credentials.create`) + a ceremonyId that threads the server-stored challenge.
//
export class PostPasskeyRegisterOptions extends RestfulEndpoint<{}, {}, PostPasskeyRegisterOptions.Response>
{
    public readonly uri      : string = PostPasskeyRegisterOptions.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.POST;
    public readonly access   : Access.Role = Access.AccountRole.USER;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    constructor() { super( {}, {} ); }

    public getMappings(): Array<RestfulEndpoint.FieldMap> { return []; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null { return null; }
}

export namespace PostPasskeyRegisterOptions
{
    export const URI : string = apiPath( "auth", 1, "/passkey/register/options" );   // /api/auth/v1/passkey/register/options

    export interface Response
    {
        ceremonyId : string;
        options    : Record<string, unknown>;   // PublicKeyCredentialCreationOptionsJSON (opaque to the contract)
    }

    export enum Error { UNAUTHORIZED = NetworkUtils.Status.UNAUTHORIZED, INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR }
}

export default PostPasskeyRegisterOptions;
