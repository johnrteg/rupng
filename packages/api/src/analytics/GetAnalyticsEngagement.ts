//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import { Analytics } from "./model/Analytics";

//
// Cross-channel engagement by account/campaign (analytics-7.1) — the engagement-taxonomy slice of
// the rollups table (`opened` / `clicked` / `replied`), one row per channel+period. Per-CONTACT
// drill-down (the SPECS' full "…/contact" scope) is DEFERRED — the rollups table has no contactId
// dimension (it would explode cardinality); that level of detail needs the raw lake (Athena, not
// built yet — see the SPECS gap register), not this hot-path aggregate.
//
export class GetAnalyticsEngagement extends RestfulEndpoint< GetAnalyticsEngagement.Query, undefined, GetAnalyticsEngagement.Response >
{
    public readonly uri      : string = GetAnalyticsEngagement.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.GET;
    public readonly access   : Access.Role = Analytics.QUERY_MIN_ACCESS;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "getAnalyticsEngagement",
        summary:     "Cross-channel engagement",
        description: "Opened/clicked/replied counts by channel + period. Account/campaign scope only — contact-level drill-down needs the (not-yet-built) Athena lake query path.",
        tags:        [ "Analytics" ],
    };

    constructor( query? : GetAnalyticsEngagement.Query ) { super( query ?? { from: "", to: "", granularity: "day" } ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap>
    {
        return [
            { field: "from",        location: RestfulEndpoint.AttrLocation.QUERY_PARAM, required: true },
            { field: "to",          location: RestfulEndpoint.AttrLocation.QUERY_PARAM, required: true },
            { field: "granularity", location: RestfulEndpoint.AttrLocation.QUERY_PARAM, required: true },
            { field: "channel",     location: RestfulEndpoint.AttrLocation.QUERY_PARAM, required: false },
            { field: "campaignId",  location: RestfulEndpoint.AttrLocation.QUERY_PARAM, required: false },
        ];
    }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema():  RestfulEndpoint.Schema | null { return null; }
}

export namespace GetAnalyticsEngagement
{
    export const URI : string = apiPath( "analytics", 1, "/engagement" );

    export interface Query
    {
        from        : Analytics.QueryFilter[ "from" ];
        to          : Analytics.QueryFilter[ "to" ];
        granularity : Analytics.Granularity;
        channel?    : Analytics.Channel;
        campaignId? : string;
    }

    export interface Response extends Analytics.Result<Analytics.MetricRow> {}

    export enum Error
    {
        BAD_REQUEST           = NetworkUtils.Status.BAD_REQUEST,
        UNAUTHORIZED          = NetworkUtils.Status.UNAUTHORIZED,
        INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR,
    }
}

export default GetAnalyticsEngagement;
// eof
