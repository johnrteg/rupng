//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import { Report } from "./model/Report";

//
// Create a report run (report-2.1/4.1/4.2) — ONE standard payload for both an ad-hoc run and a recurring
// schedule. Validates `params` against the catalog entry's `paramsSchema` and re-checks the report's own
// `minAccess` (the endpoint's floor is USER — a given report may require more). Omit `schedule` for a
// one-time run (enqueues to SQS; returns `{ submission }` immediately, status=submitted — generation is
// async, report-2.2/2.3). Supply `schedule` (RFC-5545 `ical` + an IANA `timezone`) to create a standing,
// recurring schedule instead (returns `{ schedule }`; `params.window` must be RELATIVE — a fixed one is
// rejected, report-3.3, since it would re-pull the same frozen dates on every fire).
//
export class PostReportRuns extends RestfulEndpoint< {}, PostReportRuns.Body, PostReportRuns.Response >
{
    public readonly uri      : string = PostReportRuns.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.POST;
    public readonly access   : Access.Role = Access.AccountRole.USER;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "createReportRun",
        summary:     "Create a report run (ad-hoc or recurring)",
        description: "Validates params against the report's declared schema, re-checks its minAccess, and either enqueues an ad-hoc run or creates a recurring iCal schedule, depending on whether `schedule` is supplied.",
        tags:        [ "Report" ],
    };

    constructor( body? : PostReportRuns.Body ) { super( {}, body ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return []; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null
    {
        return {
            type: "object", additionalProperties: true, required: [ "reportId", "params", "format" ],
            properties: {
                reportId:     { type: "string" },
                params:       { type: "object" },
                format:       { type: "string", enum: [ "csv", "pdf", "xlsx", "json" ] },
                destinations: { type: "array", items: { type: "object" } },
                schedule:     { type: "object", additionalProperties: false, required: [ "ical", "timezone" ],
                                properties: { ical: { type: "string" }, timezone: { type: "string" } } },
            },
        };
    }
    public getResponseSchema(): RestfulEndpoint.Schema | null
    {
        return { type: "object", properties: { submission: { type: "object" }, schedule: { type: "object" } } };
    }
}

export namespace PostReportRuns
{
    export const URI : string = apiPath( "report", 1, "/runs" );
    export interface Body extends RestfulEndpoint.AuthRequest, Report.CreateRun {}
    /** Exactly one of the two is set — `submission` for an ad-hoc run, `schedule` when `Body.schedule` was supplied. */
    export interface Response { submission? : Report.Submission; schedule? : Report.Schedule; }
    export enum Error
    {
        BAD_REQUEST  = NetworkUtils.Status.BAD_REQUEST,
        UNAUTHORIZED = NetworkUtils.Status.UNAUTHORIZED,
        FORBIDDEN    = NetworkUtils.Status.FORBIDDEN,
    }
}

export default PostReportRuns;
// eof
