//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils, Type } from "@repo/common";
import { Report } from "./model/Report";
import { Paging } from "../model/Paging";

//
// List the account's report submissions (paged, `{ records, page }` envelope), newest first — the data
// source for the submissions dashboard. Optionally filtered by `reportId` / `status` (report-2.4).
//
export class GetReportSubmissions extends RestfulEndpoint< GetReportSubmissions.Query, undefined, GetReportSubmissions.Response >
{
    public readonly uri      : string = GetReportSubmissions.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.GET;
    public readonly access   : Access.Role = Access.AccountRole.USER;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "listReportSubmissions",
        summary:     "List report submissions",
        description: "Lists the account's report submissions (paged; filterable by reportId/status), newest first.",
        tags:        [ "Report" ],
    };

    constructor( query? : GetReportSubmissions.Query ) { super( query ?? {} ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap>
    {
        return [
            { field: "reportId", location: RestfulEndpoint.AttrLocation.QUERY_PARAM, required: false },
            { field: "status",   location: RestfulEndpoint.AttrLocation.QUERY_PARAM, required: false },
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

export namespace GetReportSubmissions
{
    export const URI : string = apiPath( "report", 1, "/submissions" );
    export interface Query extends Paging.Request { reportId? : Type.ID; status? : Report.SubmissionStatus; }
    export interface Response extends Paging.Result<Report.Submission> {}
    export enum Error { UNAUTHORIZED = NetworkUtils.Status.UNAUTHORIZED }
}

export default GetReportSubmissions;
// eof
