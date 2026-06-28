//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";

//
// Begin passkey SIGN-IN → assertion options for the browser (`navigator.credentials.get`) + a
// ceremonyId. Discoverable-credential (usernameless) flow: the authenticator picks the credential.
//
export class PostLoginPasskeyOptions extends RestfulEndpoint<{}, {}, PostLoginPasskeyOptions.Response>
{
    public readonly uri      : string = PostLoginPasskeyOptions.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.POST;
    public readonly access   : Access.Role | undefined = undefined;   // pre-auth
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    constructor() { super( {}, {} ); }

    public getMappings(): Array<RestfulEndpoint.FieldMap> { return []; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null { return null; }
}

export namespace PostLoginPasskeyOptions
{
    export const URI : string = apiPath( "auth", 1, "/login/passkey/options" );   // /api/auth/v1/login/passkey/options

    export interface Response
    {
        ceremonyId : string;
        options    : Record<string, unknown>;   // PublicKeyCredentialRequestOptionsJSON (opaque to the contract)
    }

    export enum Error { INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR }
}

export default PostLoginPasskeyOptions;
