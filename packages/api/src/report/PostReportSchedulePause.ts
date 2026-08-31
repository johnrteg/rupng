//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import { Report } from "./model/Report";

//
// Manually pause a schedule (report-6.3) — `status` -> PAUSED, `pausedBy` -> the acting user. Distinct from
// the platform's own AUTO_PAUSED (set on a generation failure); only ACTIVE schedules fire.
//
export class PostReportSchedulePause extends RestfulEndpoint< PostReportSchedulePause.Query, PostReportSchedulePause.Body, PostReportSchedulePause.Response >
{
    public readonly uri      : string = PostReportSchedulePause.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.POST;
    public readonly access   : Access.Role = Access.AccountRole.USER;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "pauseReportSchedule",
        summary:     "Pause a report schedule",
        description: "Manually pauses a schedule so it stops firing until resumed.",
        tags:        [ "Report" ],
    };

    constructor( scheduleId? : string, body? : PostReportSchedulePause.Body ) { super( { scheduleId: scheduleId ?? "" }, body ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap>
    { return [ { field: "scheduleId", location: RestfulEndpoint.AttrLocation.URI, required: true } ]; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null
    { return { type: "object", additionalProperties: false, properties: { reason: { type: "string" } } }; }
}

export namespace PostReportSchedulePause
{
    export const URI : string = apiPath( "report", 1, "/schedules/:scheduleId/pause" );
    export interface Query { scheduleId : string; }
    export interface Body extends RestfulEndpoint.AuthRequest { reason? : string; }
    export interface Response { schedule : Report.Schedule; }
    export enum Error
    {
        UNAUTHORIZED = NetworkUtils.Status.UNAUTHORIZED,
        NOT_FOUND    = NetworkUtils.Status.NOT_FOUND,
    }
}

export default PostReportSchedulePause;
// eof
