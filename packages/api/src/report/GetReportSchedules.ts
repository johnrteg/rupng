//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils, Type } from "@repo/common";
import { Report } from "./model/Report";
import { Paging } from "../model/Paging";

//
// List the account's recurring schedules (paged), filterable by `reportId` / `status` / `specVersion`
// (report-4.1).
//
export class GetReportSchedules extends RestfulEndpoint< GetReportSchedules.Query, undefined, GetReportSchedules.Response >
{
    public readonly uri      : string = GetReportSchedules.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.GET;
    public readonly access   : Access.Role = Access.AccountRole.USER;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "listReportSchedules",
        summary:     "List report schedules",
        description: "Lists the account's recurring report schedules (paged; filterable by reportId/status/specVersion).",
        tags:        [ "Report" ],
    };

    constructor( query? : GetReportSchedules.Query ) { super( query ?? {} ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap>
    {
        return [
            { field: "reportId",    location: RestfulEndpoint.AttrLocation.QUERY_PARAM, required: false },
            { field: "status",      location: RestfulEndpoint.AttrLocation.QUERY_PARAM, required: false },
            { field: "specVersion", location: RestfulEndpoint.AttrLocation.QUERY_PARAM, required: false },
        ];
    }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null { return null; }
    public getResponseSchema(): RestfulEndpoint.Schema | null
    {
        return { type: "object", required: [ "records", "page" ], properties: {
            records: { type: "array", items: { type: "object" } },
            page:    { type: "object" },
        } };
    }
}

export namespace GetReportSchedules
{
    export const URI : string = apiPath( "report", 1, "/schedules" );
    export interface Query extends Paging.Request { reportId? : Type.ID; status? : Report.ScheduleStatus; specVersion? : number; }
    export interface Response extends Paging.Result<Report.Schedule> {}
    export enum Error { UNAUTHORIZED = NetworkUtils.Status.UNAUTHORIZED }
}

export default GetReportSchedules;
// eof
