//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import { Report } from "./model/Report";

//
// Resume a paused/auto-paused schedule (report-6.3) — `status` -> ACTIVE, clearing `pausedReason`/`pausedAt`/
// `pausedBy`. The caller is expected to have fixed the underlying cause (params/access/source) first.
//
export class PostReportScheduleResume extends RestfulEndpoint< PostReportScheduleResume.Query, {}, PostReportScheduleResume.Response >
{
    public readonly uri      : string = PostReportScheduleResume.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.POST;
    public readonly access   : Access.Role = Access.AccountRole.USER;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "resumeReportSchedule",
        summary:     "Resume a report schedule",
        description: "Resumes a paused or auto-paused schedule so it fires again.",
        tags:        [ "Report" ],
    };

    constructor( scheduleId? : string ) { super( { scheduleId: scheduleId ?? "" } ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap>
    { return [ { field: "scheduleId", location: RestfulEndpoint.AttrLocation.URI, required: true } ]; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null { return null; }
}

export namespace PostReportScheduleResume
{
    export const URI : string = apiPath( "report", 1, "/schedules/:scheduleId/resume" );
    export interface Query { scheduleId : string; }
    export interface Response { schedule : Report.Schedule; }
    export enum Error
    {
        UNAUTHORIZED = NetworkUtils.Status.UNAUTHORIZED,
        NOT_FOUND    = NetworkUtils.Status.NOT_FOUND,
    }
}

export default PostReportScheduleResume;
// eof
