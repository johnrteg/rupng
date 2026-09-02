//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import { Analytics } from "./model/Analytics";

//
// Deliverability — bounce/complaint/failure counts by provider + channel over a window
// (analytics-7.4; feeds dispatch's provider fail-over decisions via the internal counterpart). Read
// from the rollups table's `provider` dimension. Per-DOMAIN breakdown (the SPECS' "…/domain" scope,
// for email) is deferred — the rollup consumer doesn't extract a sending domain today.
//
export class GetAnalyticsDeliverability extends RestfulEndpoint< GetAnalyticsDeliverability.Query, undefined, GetAnalyticsDeliverability.Response >
{
    public readonly uri      : string = GetAnalyticsDeliverability.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.GET;
    public readonly access   : Access.Role = Analytics.QUERY_MIN_ACCESS;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "getAnalyticsDeliverability",
        summary:     "Deliverability by provider/channel",
        description: "Sent/delivered/bounced/complained/failed counts by provider + channel over a window.",
        tags:        [ "Analytics" ],
    };

    constructor( query? : GetAnalyticsDeliverability.Query ) { super( query ?? { from: "", to: "" } ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap>
    {
        return [
            { field: "from",     location: RestfulEndpoint.AttrLocation.QUERY_PARAM, required: true },
            { field: "to",       location: RestfulEndpoint.AttrLocation.QUERY_PARAM, required: true },
            { field: "channel",  location: RestfulEndpoint.AttrLocation.QUERY_PARAM, required: false },
            { field: "provider", location: RestfulEndpoint.AttrLocation.QUERY_PARAM, required: false },
        ];
    }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema():  RestfulEndpoint.Schema | null { return null; }
}

export namespace GetAnalyticsDeliverability
{
    export const URI : string = apiPath( "analytics", 1, "/deliverability" );

    export interface Query
    {
        from      : Analytics.QueryFilter[ "from" ];
        to        : Analytics.QueryFilter[ "to" ];
        channel?  : Analytics.Channel;
        provider? : Analytics.Provider;
    }

    export interface Response { data : Array<Analytics.Deliverability>; }

    export enum Error
    {
        BAD_REQUEST           = NetworkUtils.Status.BAD_REQUEST,
        UNAUTHORIZED          = NetworkUtils.Status.UNAUTHORIZED,
        INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR,
    }
}

export default GetAnalyticsDeliverability;
// eof
