//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import { Events } from "@repo/system";
import { Audit } from "./model/Audit";
import { Paging } from "../model/Paging";

//
// Query the ACTING ACCOUNT's audit trail (filters: actor, action, target, time-range; paged). ACCOUNT
// admin only — `accountId` is pinned server-side from the caller's auth, never taken from the query
// (audit-5.1). Reading the trail is itself audited (audit-5.2, done by the impl, not this contract).
//
export class GetAuditEvents extends RestfulEndpoint< GetAuditEvents.Query, undefined, GetAuditEvents.Response >
{
    public readonly uri      : string = GetAuditEvents.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.GET;
    public readonly access   : Access.Role = Access.AccountRole.ACCOUNT;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "getAuditEvents",
        summary:     "Query the account's audit trail",
        description: "Lists the acting account's audit events (filtered, paged). Tenant-scoped — accountId is pinned server-side.",
        tags:        [ "Audit" ],
    };

    constructor( query? : GetAuditEvents.Query ) { super( query ?? {} ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap>
    {
        return [
            { field: "count",      location: RestfulEndpoint.AttrLocation.QUERY_PARAM, required: false },
            { field: "start",      location: RestfulEndpoint.AttrLocation.QUERY_PARAM, required: false },
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

export namespace GetAuditEvents
{
    export const URI : string = apiPath( "audit", 1, "/events" );

    export interface Query extends Paging.Request, Omit<Audit.QueryFilter, "accountId"> {}

    export interface Response extends Paging.Result<Audit.EventView> {}

    export enum Error
    {
        UNAUTHORIZED          = NetworkUtils.Status.UNAUTHORIZED,
        FORBIDDEN             = NetworkUtils.Status.FORBIDDEN,
        INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR,
    }
}

export default GetAuditEvents;
// eof
