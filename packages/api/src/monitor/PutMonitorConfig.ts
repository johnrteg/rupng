//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import { MonitorConfig } from "./model/MonitorConfig";

//
// Set the monitor service's runtime config (AppConfig-backed). ROOT. The body is the full
// MonitorConfig.Config; the impl validates against MonitorConfig.SCHEMA + persists to AppConfig.
//
export class PutMonitorConfig extends RestfulEndpoint< {}, PutMonitorConfig.Body, PutMonitorConfig.Response >
{
    public readonly uri      : string = PutMonitorConfig.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.PUT;
    public readonly access   : Access.Role = Access.AppRole.ROOT;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "setMonitorConfig",
        summary:     "Set monitor service config",
        description: "Replaces the monitor service's runtime configuration (validated against the config schema).",
        tags:        [ "Monitor" ],
    };

    constructor( body? : PutMonitorConfig.Body ) { super( {}, body ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return []; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    // the config is a nested object; validate loosely here (the impl runs the strict MonitorConfig.SCHEMA)
    public getBodySchema(): RestfulEndpoint.Schema | null
    { return { type: "object", additionalProperties: true, required: [ "config" ], properties: { config: { type: "object" } } }; }
}

export namespace PutMonitorConfig
{
    export const URI : string = apiPath( "monitor", 1, "/config" );
    export interface Body extends RestfulEndpoint.AuthRequest { config : MonitorConfig.Config; }
    export interface Response { config : MonitorConfig.Config; }
    export enum Error
    {
        BAD_REQUEST  = NetworkUtils.Status.BAD_REQUEST,
        UNAUTHORIZED = NetworkUtils.Status.UNAUTHORIZED,
        FORBIDDEN    = NetworkUtils.Status.FORBIDDEN,
    }
}

export default PutMonitorConfig;
// eof
