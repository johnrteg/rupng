//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";

//
// List the signed-in caller's enrolled passkeys (no public-key material) — for a "manage passkeys" UI.
//
export class GetPasskeys extends RestfulEndpoint<{}, undefined, GetPasskeys.Response>
{
    public readonly uri      : string = GetPasskeys.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.GET;
    public readonly access   : Access.Role = Access.AccountRole.USER;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    constructor() { super( {} ); }

    public getMappings(): Array<RestfulEndpoint.FieldMap> { return []; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null { return null; }
}

export namespace GetPasskeys
{
    export const URI : string = apiPath( "auth", 1, "/passkeys" );   // /api/auth/v1/passkeys

    export interface Passkey { credentialId : string; transports? : Array<string>; createdAt : string; }
    export interface Response { passkeys : Array<Passkey>; }

    export enum Error { UNAUTHORIZED = NetworkUtils.Status.UNAUTHORIZED, INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR }
}

export default GetPasskeys;
