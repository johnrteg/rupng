//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";

//
// Delete one submission + its artifact (report-2.4). Removes the DynamoDB row and the S3 object (when
// present); idempotent from the caller's view — deleting an already-deleted/unknown id is a NOT_FOUND, not
// a crash.
//
export class DeleteReportSubmission extends RestfulEndpoint< DeleteReportSubmission.Query, undefined, DeleteReportSubmission.Response >
{
    public readonly uri      : string = DeleteReportSubmission.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.DELETE;
    public readonly access   : Access.Role = Access.AccountRole.USER;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "deleteReportSubmission",
        summary:     "Delete a report submission",
        description: "Deletes a submission's audit row and its S3 artifact (when present).",
        tags:        [ "Report" ],
    };

    constructor( submissionId? : string ) { super( { submissionId: submissionId ?? "" } ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap>
    { return [ { field: "submissionId", location: RestfulEndpoint.AttrLocation.URI, required: true } ]; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null { return null; }
}

export namespace DeleteReportSubmission
{
    export const URI : string = apiPath( "report", 1, "/submissions/:submissionId" );
    export interface Query { submissionId : string; }
    export interface Response { deleted : true; }
    export enum Error { UNAUTHORIZED = NetworkUtils.Status.UNAUTHORIZED, NOT_FOUND = NetworkUtils.Status.NOT_FOUND }
}

export default DeleteReportSubmission;
// eof
