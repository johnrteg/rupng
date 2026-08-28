//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import { MonitorConfig } from "./model/MonitorConfig";

//
// Read the monitor service's runtime config (the widget list). ROOT — platform operator surface.
//
export class GetMonitorConfig extends RestfulEndpoint< {}, undefined, GetMonitorConfig.Response >
{
    public readonly uri      : string = GetMonitorConfig.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.GET;
    public readonly access   : Access.Role = Access.AppRole.ROOT;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "getMonitorConfig",
        summary:     "Get monitor service config",
        description: "Reads the monitor service's runtime configuration.",
        tags:        [ "Monitor" ],
    };

    constructor() { super( {} ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return []; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null { return null; }
}

export namespace GetMonitorConfig
{
    export const URI : string = apiPath( "monitor", 1, "/config" );
    export interface Response { config : MonitorConfig.Config; }
    export enum Error { UNAUTHORIZED = NetworkUtils.Status.UNAUTHORIZED, FORBIDDEN = NetworkUtils.Status.FORBIDDEN }
}

export default GetMonitorConfig;
// eof
