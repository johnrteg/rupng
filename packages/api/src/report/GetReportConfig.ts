//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import { ReportConfig } from "./model/ReportConfig";

//
// Read the report service's runtime config (AppConfig-backed — environment-max artifact retention). ROOT —
// platform operator surface.
//
export class GetReportConfig extends RestfulEndpoint< {}, undefined, GetReportConfig.Response >
{
    public readonly uri      : string = GetReportConfig.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.GET;
    public readonly access   : Access.Role = Access.AppRole.ROOT;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "getReportConfig",
        summary:     "Get report service config",
        description: "Reads the report service's runtime configuration (environment-max artifact retention).",
        tags:        [ "Report" ],
    };

    constructor() { super( {} ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return []; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null { return null; }
}

export namespace GetReportConfig
{
    export const URI : string = apiPath( "report", 1, "/config" );
    export interface Response { config : ReportConfig.Config; }
    export enum Error { UNAUTHORIZED = NetworkUtils.Status.UNAUTHORIZED, FORBIDDEN = NetworkUtils.Status.FORBIDDEN }
}

export default GetReportConfig;
// eof
