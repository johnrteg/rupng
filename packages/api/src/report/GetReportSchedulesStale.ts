//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import { Report } from "./model/Report";
import { Paging } from "../model/Paging";

//
// Pre-drop sweep (report-8.2) — lists schedules still pinned to an old `specVersion`, across ALL accounts,
// so CS can coordinate a stop + restart on the latest version (human-in-the-loop; no auto-migration today).
// APPLICATION — a platform ops surface, not account-scoped.
//
export class GetReportSchedulesStale extends RestfulEndpoint< GetReportSchedulesStale.Query, undefined, GetReportSchedulesStale.Response >
{
    public readonly uri      : string = GetReportSchedulesStale.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.GET;
    public readonly access   : Access.Role = Access.AppRole.APPLICATION;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "listStaleReportSchedules",
        summary:     "List schedules pinned to an old spec version",
        description: "Lists schedules (any account) still pinned to the given specVersion, ahead of dropping it.",
        tags:        [ "Report" ],
    };

    constructor( query? : GetReportSchedulesStale.Query ) { super( query ?? { specVersion: 0 } ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap>
    { return [ { field: "specVersion", location: RestfulEndpoint.AttrLocation.QUERY_PARAM, required: true } ]; }
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

export namespace GetReportSchedulesStale
{
    export const URI : string = apiPath( "report", 1, "/schedules/stale" );
    export interface Query extends Paging.Request { specVersion : number; }
    export interface Response extends Paging.Result<Report.Schedule> {}
    export enum Error { UNAUTHORIZED = NetworkUtils.Status.UNAUTHORIZED, FORBIDDEN = NetworkUtils.Status.FORBIDDEN }
}

export default GetReportSchedulesStale;
// eof
