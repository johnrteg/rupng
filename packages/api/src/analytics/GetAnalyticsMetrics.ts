//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import { Analytics } from "./model/Analytics";

//
// Aggregate metrics — counts by event-type/channel/campaign/period (analytics-5.1/7.1), read from
// the near-real-time rollups table (never the raw lake — analytics-5.2). Tenant-scoped to the
// caller's acting account (X-Account); the SPECS' staff cross-account view (analytics-5.3) is
// deferred — this cut always scopes to `auth.accountId`.
//
export class GetAnalyticsMetrics extends RestfulEndpoint< GetAnalyticsMetrics.Query, undefined, GetAnalyticsMetrics.Response >
{
    public readonly uri      : string = GetAnalyticsMetrics.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.GET;
    public readonly access   : Access.Role = Analytics.QUERY_MIN_ACCESS;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "getAnalyticsMetrics",
        summary:     "Aggregate engagement metrics",
        description: "Counts by event-type/channel/campaign/period, read from the rollups table.",
        tags:        [ "Analytics" ],
    };

    constructor( query? : GetAnalyticsMetrics.Query ) { super( query ?? { from: "", to: "", granularity: "day" } ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap>
    {
        return [
            { field: "from",        location: RestfulEndpoint.AttrLocation.QUERY_PARAM, required: true },
            { field: "to",          location: RestfulEndpoint.AttrLocation.QUERY_PARAM, required: true },
            { field: "granularity", location: RestfulEndpoint.AttrLocation.QUERY_PARAM, required: true },
            { field: "channel",     location: RestfulEndpoint.AttrLocation.QUERY_PARAM, required: false },
            { field: "campaignId",  location: RestfulEndpoint.AttrLocation.QUERY_PARAM, required: false },
            { field: "eventType",   location: RestfulEndpoint.AttrLocation.QUERY_PARAM, required: false },
        ];
    }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema():  RestfulEndpoint.Schema | null { return null; }
}

export namespace GetAnalyticsMetrics
{
    export const URI : string = apiPath( "analytics", 1, "/metrics" );

    export interface Query
    {
        from        : Analytics.QueryFilter[ "from" ];
        to          : Analytics.QueryFilter[ "to" ];
        granularity : Analytics.Granularity;
        channel?    : Analytics.Channel;
        campaignId? : string;
        eventType?  : Analytics.EventVerb;
    }

    export interface Response extends Analytics.Result<Analytics.MetricRow> {}

    export enum Error
    {
        BAD_REQUEST           = NetworkUtils.Status.BAD_REQUEST,
        UNAUTHORIZED          = NetworkUtils.Status.UNAUTHORIZED,
        INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR,
    }
}

export default GetAnalyticsMetrics;
// eof
