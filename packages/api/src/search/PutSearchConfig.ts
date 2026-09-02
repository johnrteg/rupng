//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import { SearchConfig } from "./model/SearchConfig";

//
// Set the search service's runtime config (AppConfig-backed). ROOT. The body is the full SearchConfig.Config;
// the impl validates against SearchConfig.SCHEMA + persists to AppConfig (search-4.0/5.3).
//
export class PutSearchConfig extends RestfulEndpoint< {}, PutSearchConfig.Body, PutSearchConfig.Response >
{
    public readonly uri      : string = PutSearchConfig.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.PUT;
    public readonly access   : Access.Role = Access.AppRole.ROOT;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "setSearchConfig",
        summary:     "Set search service config",
        description: "Replaces the search service's runtime configuration (validated against the config schema).",
        tags:        [ "Search" ],
    };

    constructor( body? : PutSearchConfig.Body ) { super( {}, body ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return []; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    // the config is a nested object; validate loosely here (the impl runs the strict SearchConfig.SCHEMA)
    public getBodySchema(): RestfulEndpoint.Schema | null
    { return { type: "object", additionalProperties: true, required: [ "config" ], properties: { config: { type: "object" } } }; }
}

export namespace PutSearchConfig
{
    export const URI : string = apiPath( "search", 1, "/config" );
    export interface Body extends RestfulEndpoint.AuthRequest { config : SearchConfig.Config; }
    export interface Response { config : SearchConfig.Config; }
    export enum Error
    {
        BAD_REQUEST  = NetworkUtils.Status.BAD_REQUEST,
        UNAUTHORIZED = NetworkUtils.Status.UNAUTHORIZED,
        FORBIDDEN    = NetworkUtils.Status.FORBIDDEN,
    }
}

export default PutSearchConfig;
// eof
