//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import { Report } from "./model/Report";

//
// Get a single schedule's detail by id (report-4.2) — including `lastFiredAt` / `nextFireAt` / pause state.
//
export class GetReportSchedule extends RestfulEndpoint< GetReportSchedule.Query, undefined, GetReportSchedule.Response >
{
    public readonly uri      : string = GetReportSchedule.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.GET;
    public readonly access   : Access.Role = Access.AccountRole.USER;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "getReportSchedule",
        summary:     "Get a report schedule",
        description: "Fetches one schedule's detail, including lastFiredAt/nextFireAt and pause state.",
        tags:        [ "Report" ],
    };

    constructor( scheduleId? : string ) { super( { scheduleId: scheduleId ?? "" } ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap>
    { return [ { field: "scheduleId", location: RestfulEndpoint.AttrLocation.URI, required: true } ]; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null { return null; }
}

export namespace GetReportSchedule
{
    export const URI : string = apiPath( "report", 1, "/schedules/:scheduleId" );
    export interface Query { scheduleId : string; }
    export interface Response { schedule : Report.Schedule; }
    export enum Error { UNAUTHORIZED = NetworkUtils.Status.UNAUTHORIZED, NOT_FOUND = NetworkUtils.Status.NOT_FOUND }
}

export default GetReportSchedule;
// eof
