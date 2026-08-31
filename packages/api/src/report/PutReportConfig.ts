//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import { ReportConfig } from "./model/ReportConfig";

//
// Set the report service's runtime config (AppConfig-backed). ROOT. The body is the full ReportConfig.Config;
// the impl validates against ReportConfig.SCHEMA + persists to AppConfig.
//
export class PutReportConfig extends RestfulEndpoint< {}, PutReportConfig.Body, PutReportConfig.Response >
{
    public readonly uri      : string = PutReportConfig.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.PUT;
    public readonly access   : Access.Role = Access.AppRole.ROOT;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "setReportConfig",
        summary:     "Set report service config",
        description: "Replaces the report service's runtime configuration (validated against the config schema).",
        tags:        [ "Report" ],
    };

    constructor( body? : PutReportConfig.Body ) { super( {}, body ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return []; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    // the config is a nested object; validate loosely here (the impl runs the strict ReportConfig.SCHEMA)
    public getBodySchema(): RestfulEndpoint.Schema | null
    { return { type: "object", additionalProperties: true, required: [ "config" ], properties: { config: { type: "object" } } }; }
}

export namespace PutReportConfig
{
    export const URI : string = apiPath( "report", 1, "/config" );
    export interface Body extends RestfulEndpoint.AuthRequest { config : ReportConfig.Config; }
    export interface Response { config : ReportConfig.Config; }
    export enum Error
    {
        BAD_REQUEST  = NetworkUtils.Status.BAD_REQUEST,
        UNAUTHORIZED = NetworkUtils.Status.UNAUTHORIZED,
        FORBIDDEN    = NetworkUtils.Status.FORBIDDEN,
    }
}

export default PutReportConfig;
// eof
