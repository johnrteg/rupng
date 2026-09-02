//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import { Events } from "@repo/system";
import { Audit } from "./model/Audit";
import { Paging } from "../model/Paging";

//
// Cross-tenant audit trail view for staff / auditors (audit-5.1). Unlike `GetAuditEvents`, `accountId`
// is NOT pinned — a staff caller may omit it (spans all tenants) or scope to one. APPLICATION-gated.
// Reading the trail is itself audited (audit-5.2, done by the impl).
//
export class GetStaffAuditEvents extends RestfulEndpoint< GetStaffAuditEvents.Query, undefined, GetStaffAuditEvents.Response >
{
    public readonly uri      : string = GetStaffAuditEvents.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.GET;
    public readonly access   : Access.Role = Access.AppRole.APPLICATION;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "getStaffAuditEvents",
        summary:     "Query the audit trail across tenants (staff)",
        description: "Cross-tenant audit trail query for staff/auditors — accountId is optional (omit to span all tenants).",
        tags:        [ "Audit" ],
    };

    constructor( query? : GetStaffAuditEvents.Query ) { super( query ?? {} ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap>
    {
        return [
            { field: "count",      location: RestfulEndpoint.AttrLocation.QUERY_PARAM, required: false },
            { field: "start",      location: RestfulEndpoint.AttrLocation.QUERY_PARAM, required: false },
            { field: "accountId",  location: RestfulEndpoint.AttrLocation.QUERY_PARAM, required: false },
            { field: "actorId",    location: RestfulEndpoint.AttrLocation.QUERY_PARAM, required: false },
            { field: "action",     location: RestfulEndpoint.AttrLocation.QUERY_PARAM, required: false },
            { field: "targetType", location: RestfulEndpoint.AttrLocation.QUERY_PARAM, required: false },
            { field: "targetId",   location: RestfulEndpoint.AttrLocation.QUERY_PARAM, required: false },
            { field: "outcome",    location: RestfulEndpoint.AttrLocation.QUERY_PARAM, required: false },
            { field: "from",       location: RestfulEndpoint.AttrLocation.QUERY_PARAM, required: false },
            { field: "to",         location: RestfulEndpoint.AttrLocation.QUERY_PARAM, required: false },
        ];
    }
    public getQuerySchema(): RestfulEndpoint.Schema | null
    {
        return {
            type: "object",
            properties: {
                count:      { type: "number", description: "Desired page size." },
                start:      { type: "string", description: "Opaque page token (echo a prior page's `next`)." },
                accountId:  { type: "string", description: "Scope to one tenant; omit to span every tenant." },
                actorId:    { type: "string", description: "Filter to one actor id." },
                action:     { type: "string", description: "Filter to one action (`<object>.<verb>`)." },
                targetType: { type: "string", description: "Filter to a target type." },
                targetId:   { type: "string", description: "Filter to one target id." },
                outcome:    { type: "string", enum: Object.values( Events.Outcome ), description: "Filter by outcome." },
                from:       { type: "string", format: "date-time", description: "Range start (inclusive)." },
                to:         { type: "string", format: "date-time", description: "Range end (inclusive)." },
            },
        };
    }
    public getBodySchema():  RestfulEndpoint.Schema | null { return null; }
}

export namespace GetStaffAuditEvents
{
    export const URI : string = apiPath( "audit", 1, "/events/staff" );

    export interface Query extends Paging.Request, Audit.QueryFilter {}

    export interface Response extends Paging.Result<Audit.EventView> {}

    export enum Error
    {
        UNAUTHORIZED          = NetworkUtils.Status.UNAUTHORIZED,
        FORBIDDEN             = NetworkUtils.Status.FORBIDDEN,
        INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR,
    }
}

export default GetStaffAuditEvents;
// eof
