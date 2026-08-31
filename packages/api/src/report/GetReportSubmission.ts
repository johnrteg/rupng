//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import { Report } from "./model/Report";

//
// Get a single submission's status + facts by id (report-2.3) — status, size, recordCount, the resolved
// window, and the error (when status=error).
//
export class GetReportSubmission extends RestfulEndpoint< GetReportSubmission.Query, undefined, GetReportSubmission.Response >
{
    public readonly uri      : string = GetReportSubmission.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.GET;
    public readonly access   : Access.Role = Access.AccountRole.USER;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "getReportSubmission",
        summary:     "Get a report submission",
        description: "Fetches one submission's current status + facts (size, recordCount, resolved window, error) by id.",
        tags:        [ "Report" ],
    };

    constructor( submissionId? : string ) { super( { submissionId: submissionId ?? "" } ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap>
    { return [ { field: "submissionId", location: RestfulEndpoint.AttrLocation.URI, required: true } ]; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null { return null; }
}

export namespace GetReportSubmission
{
    export const URI : string = apiPath( "report", 1, "/submissions/:submissionId" );
    export interface Query { submissionId : string; }
    export interface Response { submission : Report.Submission; }
    export enum Error { UNAUTHORIZED = NetworkUtils.Status.UNAUTHORIZED, NOT_FOUND = NetworkUtils.Status.NOT_FOUND }
}

export default GetReportSubmission;
// eof
