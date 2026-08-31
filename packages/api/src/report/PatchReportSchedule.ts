//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils, Type } from "@repo/common";
import { Report } from "./model/Report";

//
// Update a schedule's `ical` / `params` / `format` / `timezone` / `destination` (report-4.1). A partial
// PATCH — only supplied fields change; `params` (when supplied) is re-validated against the report's
// current `paramsSchema` and must still carry a RELATIVE date window.
//
export class PatchReportSchedule extends RestfulEndpoint< PatchReportSchedule.Query, PatchReportSchedule.Body, PatchReportSchedule.Response >
{
    public readonly uri      : string = PatchReportSchedule.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.PATCH;
    public readonly access   : Access.Role = Access.AccountRole.USER;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "updateReportSchedule",
        summary:     "Update a report schedule",
        description: "Partially updates a schedule's ical/params/format/timezone/destination.",
        tags:        [ "Report" ],
    };

    constructor( scheduleId? : string, body? : PatchReportSchedule.Body ) { super( { scheduleId: scheduleId ?? "" }, body ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap>
    { return [ { field: "scheduleId", location: RestfulEndpoint.AttrLocation.URI, required: true } ]; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null
    {
        return {
            type: "object", additionalProperties: true,
            properties: {
                ical:        { type: "string" },
                params:      { type: "object" },
                format:      { type: "string", enum: [ "csv", "pdf", "xlsx", "json" ] },
                timezone:    { type: "string" },
                destination: { type: "object" },
            },
        };
    }
}

export namespace PatchReportSchedule
{
    export const URI : string = apiPath( "report", 1, "/schedules/:scheduleId" );
    export interface Query { scheduleId : string; }
    export interface Body extends RestfulEndpoint.AuthRequest
    {
        ical?        : string;
        params?      : Type.Json;
        format?      : Report.Format;
        timezone?    : string;
        destination? : Report.Destination;
    }
    export interface Response { schedule : Report.Schedule; }
    export enum Error
    {
        BAD_REQUEST  = NetworkUtils.Status.BAD_REQUEST,
        UNAUTHORIZED = NetworkUtils.Status.UNAUTHORIZED,
        NOT_FOUND    = NetworkUtils.Status.NOT_FOUND,
    }
}

export default PatchReportSchedule;
// eof
