//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import { SearchConfig } from "./model/SearchConfig";

//
// Read the search service's runtime config (AppConfig-backed — indexed types, per-type weights, query-audit
// posture). ROOT — platform operator surface (search-4.0/5.3).
//
export class GetSearchConfig extends RestfulEndpoint< {}, undefined, GetSearchConfig.Response >
{
    public readonly uri      : string = GetSearchConfig.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.GET;
    public readonly access   : Access.Role = Access.AppRole.ROOT;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "getSearchConfig",
        summary:     "Get search service config",
        description: "Reads the search service's runtime configuration (indexed types, weights, query-audit posture).",
        tags:        [ "Search" ],
    };

    constructor() { super( {} ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return []; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null { return null; }
}

export namespace GetSearchConfig
{
    export const URI : string = apiPath( "search", 1, "/config" );
    export interface Response { config : SearchConfig.Config; }
    export enum Error { UNAUTHORIZED = NetworkUtils.Status.UNAUTHORIZED, FORBIDDEN = NetworkUtils.Status.FORBIDDEN }
}

export default GetSearchConfig;
// eof
