//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import { Report } from "./model/Report";

//
// Create a recurring (iCal) schedule (report-4.1/4.2). `params` must carry a RELATIVE `DateWindow` — the
// impl rejects a fixed one (report-3.3): a fixed window would re-pull the same frozen dates on every fire.
//
export class PostReportSchedules extends RestfulEndpoint< {}, PostReportSchedules.Body, PostReportSchedules.Response >
{
    public readonly uri      : string = PostReportSchedules.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.POST;
    public readonly access   : Access.Role = Access.AccountRole.USER;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "createReportSchedule",
        summary:     "Create a report schedule",
        description: "Creates a recurring (iCal) report schedule — params must carry a RELATIVE date window (fixed is rejected).",
        tags:        [ "Report" ],
    };

    constructor( body? : PostReportSchedules.Body ) { super( {}, body ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return []; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null
    {
        return {
            type: "object", additionalProperties: true, required: [ "reportId", "ical", "timezone", "params", "format" ],
            properties: {
                reportId:    { type: "string" },
                ical:        { type: "string" },
                timezone:    { type: "string" },
                params:      { type: "object" },
                format:      { type: "string", enum: [ "csv", "pdf", "xlsx", "json" ] },
                destination: { type: "object" },
            },
        };
    }
    public getResponseSchema(): RestfulEndpoint.Schema | null
    {
        return { type: "object", required: [ "schedule" ], properties: { schedule: { type: "object" } } };
    }
}

export namespace PostReportSchedules
{
    export const URI : string = apiPath( "report", 1, "/schedules" );
    export interface Body extends RestfulEndpoint.AuthRequest, Report.CreateSchedule {}
    export interface Response { schedule : Report.Schedule; }
    export enum Error
    {
        BAD_REQUEST  = NetworkUtils.Status.BAD_REQUEST,
        UNAUTHORIZED = NetworkUtils.Status.UNAUTHORIZED,
        FORBIDDEN    = NetworkUtils.Status.FORBIDDEN,
    }
}

export default PostReportSchedules;
// eof
