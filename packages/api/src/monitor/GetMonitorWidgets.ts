//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import { MonitorConfig } from "./model/MonitorConfig";

//
// List the configured dashboard widgets (from MonitorConfig). Platform-wide operational data —
// staff only.
//
export class GetMonitorWidgets extends RestfulEndpoint< {}, undefined, GetMonitorWidgets.Response >
{
    public readonly uri      : string = GetMonitorWidgets.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.GET;
    public readonly access   : Access.Role = Access.AppRole.SUPPORT;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "getMonitorWidgets",
        summary:     "List monitor dashboard widgets",
        description: "Reads the configured MonitorConfig widget list.",
        tags:        [ "Monitor" ],
    };

    constructor() { super( {} ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return []; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null { return null; }
}

export namespace GetMonitorWidgets
{
    export const URI : string = apiPath( "monitor", 1, "/widgets" );
    export interface Response { widgets : Array<MonitorConfig.WidgetConfig>; }
    export enum Error { UNAUTHORIZED = NetworkUtils.Status.UNAUTHORIZED, FORBIDDEN = NetworkUtils.Status.FORBIDDEN }
}

export default GetMonitorWidgets;
// eof
