//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";

//
// Delete a schedule (report-4.2). Does not touch already-produced Submissions (each fire's Submission is an
// independent, immutable audit record); only stops FUTURE fires.
//
export class DeleteReportSchedule extends RestfulEndpoint< DeleteReportSchedule.Query, undefined, DeleteReportSchedule.Response >
{
    public readonly uri      : string = DeleteReportSchedule.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.DELETE;
    public readonly access   : Access.Role = Access.AccountRole.USER;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "deleteReportSchedule",
        summary:     "Delete a report schedule",
        description: "Deletes a schedule; already-produced submissions are untouched (only future fires stop).",
        tags:        [ "Report" ],
    };

    constructor( scheduleId? : string ) { super( { scheduleId: scheduleId ?? "" } ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap>
    { return [ { field: "scheduleId", location: RestfulEndpoint.AttrLocation.URI, required: true } ]; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null { return null; }
}

export namespace DeleteReportSchedule
{
    export const URI : string = apiPath( "report", 1, "/schedules/:scheduleId" );
    export interface Query { scheduleId : string; }
    export interface Response { deleted : true; }
    export enum Error { UNAUTHORIZED = NetworkUtils.Status.UNAUTHORIZED, NOT_FOUND = NetworkUtils.Status.NOT_FOUND }
}

export default DeleteReportSchedule;
// eof
