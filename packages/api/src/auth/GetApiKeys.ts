//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import { ApiKey } from "./model/ApiKey";

//
// List the acting account's developer API keys (secret-free views). Account-scoped: returns keys owned by the
// caller's acting account (X-Account). USER role to view.
//
export class GetApiKeys extends RestfulEndpoint<{}, undefined, GetApiKeys.Response>
{
    public readonly uri      : string = GetApiKeys.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.GET;
    public readonly access   : Access.Role = Access.AccountRole.USER;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    constructor() { super( {} ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return []; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null { return null; }
}

export namespace GetApiKeys
{
    export const URI : string = apiPath( "auth", 1, "/api-keys" );   // /api/auth/v1/api-keys
    export interface Response { keys : Array<ApiKey.View>; }
    export enum Error { UNAUTHORIZED = NetworkUtils.Status.UNAUTHORIZED, INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR }
}

export default GetApiKeys;
