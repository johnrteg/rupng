//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils, type Type } from "@repo/common";
import { MonitorWidgetStatus } from "./model/MonitorWidgetStatus";

//
// Live read for one configured widget — cache-first (a short TTL in front of the underlying AWS
// call so the dashboard's poll loop doesn't hammer the source). Platform-wide operational data —
// staff only.
//
export class GetMonitorWidgetData extends RestfulEndpoint< GetMonitorWidgetData.Query, undefined, GetMonitorWidgetData.Response >
{
    public readonly uri      : string = GetMonitorWidgetData.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.GET;
    public readonly access   : Access.Role = Access.AppRole.SUPPORT;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "getMonitorWidgetData",
        summary:     "Read one widget's live status",
        description: "Queries the widget's configured resource (cache-first) and returns its current status.",
        tags:        [ "Monitor" ],
        errors:      { 404: "No such widget in MonitorConfig" },
    };

    constructor( id? : string ) { super( { id: id ?? "" } ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return [ { field: "id", location: RestfulEndpoint.AttrLocation.URI, required: true } ]; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null { return null; }
}

export namespace GetMonitorWidgetData
{
    export const URI : string = apiPath( "monitor", 1, "/widgets/:id/data" );
    export interface Query { id : Type.UUID; }
    export interface Response extends MonitorWidgetStatus.Data {}
    export enum Error
    {
        UNAUTHORIZED = NetworkUtils.Status.UNAUTHORIZED,
        FORBIDDEN    = NetworkUtils.Status.FORBIDDEN,
        NOT_FOUND    = NetworkUtils.Status.NOT_FOUND,
    }
}

export default GetMonitorWidgetData;
// eof
