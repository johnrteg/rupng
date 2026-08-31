//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";

//
// Presigned GET for a completed submission's artifact (report-5.2). Private bucket — no public URL; the
// returned `url` is short-lived (`expiresAt`).
//
export class GetReportSubmissionDownload extends RestfulEndpoint< GetReportSubmissionDownload.Query, undefined, GetReportSubmissionDownload.Response >
{
    public readonly uri      : string = GetReportSubmissionDownload.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.GET;
    public readonly access   : Access.Role = Access.AccountRole.USER;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "getReportSubmissionDownload",
        summary:     "Get a submission's download URL",
        description: "Issues a short-lived presigned GET for a completed submission's artifact.",
        tags:        [ "Report" ],
    };

    constructor( submissionId? : string ) { super( { submissionId: submissionId ?? "" } ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap>
    { return [ { field: "submissionId", location: RestfulEndpoint.AttrLocation.URI, required: true } ]; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null { return null; }
    public getResponseSchema(): RestfulEndpoint.Schema | null
    {
        return { type: "object", required: [ "url", "expiresAt" ], properties: {
            url:       { type: "string" },
            expiresAt: { type: "string", format: "date-time" },
        } };
    }
}

export namespace GetReportSubmissionDownload
{
    export const URI : string = apiPath( "report", 1, "/submissions/:submissionId/download" );
    export interface Query { submissionId : string; }
    export interface Response { url : string; expiresAt : string; }
    export enum Error
    {
        UNAUTHORIZED = NetworkUtils.Status.UNAUTHORIZED,
        NOT_FOUND    = NetworkUtils.Status.NOT_FOUND,
        // the artifact isn't ready yet (status != complete) — surfaced distinctly from a plain 404
        CONFLICT     = NetworkUtils.Status.CONFLICT,
    }
}

export default GetReportSubmissionDownload;
// eof
