//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import { Report } from "./model/Report";

//
// Submit an ad-hoc report run (report-2.1). Validates `params` against the catalog entry's `paramsSchema`
// and re-checks the report's own `minAccess` (the endpoint's floor is USER — a given report may require
// more). Enqueues to SQS; returns the created `Submission` (status=submitted) immediately — generation is
// async (report-2.2/2.3).
//
export class PostReportSubmissions extends RestfulEndpoint< {}, PostReportSubmissions.Body, PostReportSubmissions.Response >
{
    public readonly uri      : string = PostReportSubmissions.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.POST;
    public readonly access   : Access.Role = Access.AccountRole.USER;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "submitReport",
        summary:     "Submit an ad-hoc report run",
        description: "Validates params against the report's declared schema, re-checks its minAccess, and enqueues an ad-hoc generation run.",
        tags:        [ "Report" ],
    };

    constructor( body? : PostReportSubmissions.Body ) { super( {}, body ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return []; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null
    {
        return {
            type: "object", additionalProperties: true, required: [ "reportId", "params", "format" ],
            properties: {
                reportId:    { type: "string" },
                params:      { type: "object" },
                format:      { type: "string", enum: [ "csv", "pdf", "xlsx", "json" ] },
                destination: { type: "object" },
            },
        };
    }
    public getResponseSchema(): RestfulEndpoint.Schema | null
    {
        return { type: "object", required: [ "submission" ], properties: { submission: { type: "object" } } };
    }
}

export namespace PostReportSubmissions
{
    export const URI : string = apiPath( "report", 1, "/submissions" );
    export interface Body extends RestfulEndpoint.AuthRequest, Report.SubmitRequest {}
    export interface Response { submission : Report.Submission; }
    export enum Error
    {
        BAD_REQUEST  = NetworkUtils.Status.BAD_REQUEST,
        UNAUTHORIZED = NetworkUtils.Status.UNAUTHORIZED,
        FORBIDDEN    = NetworkUtils.Status.FORBIDDEN,
    }
}

export default PostReportSubmissions;
// eof
