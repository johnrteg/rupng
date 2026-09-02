//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import { Analytics } from "./model/Analytics";

//
// Funnel stages — sent -> delivered -> opened -> clicked -> converted, per campaign (analytics-7.2).
// Read from the rollups table, summed over the requested window; `rate` is stage/previous-stage.
//
export class GetAnalyticsFunnels extends RestfulEndpoint< GetAnalyticsFunnels.Query, undefined, GetAnalyticsFunnels.Response >
{
    public readonly uri      : string = GetAnalyticsFunnels.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.GET;
    public readonly access   : Access.Role = Analytics.QUERY_MIN_ACCESS;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "getAnalyticsFunnels",
        summary:     "Campaign funnel stages",
        description: "Sent -> delivered -> opened -> clicked -> converted counts + stage-over-stage rates for one campaign.",
        tags:        [ "Analytics" ],
    };

    constructor( query? : GetAnalyticsFunnels.Query ) { super( query ?? { campaignId: "", from: "", to: "" } ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap>
    {
        return [
            { field: "campaignId", location: RestfulEndpoint.AttrLocation.QUERY_PARAM, required: true },
            { field: "from",       location: RestfulEndpoint.AttrLocation.QUERY_PARAM, required: true },
            { field: "to",         location: RestfulEndpoint.AttrLocation.QUERY_PARAM, required: true },
            { field: "channel",    location: RestfulEndpoint.AttrLocation.QUERY_PARAM, required: false },
            { field: "variant",    location: RestfulEndpoint.AttrLocation.QUERY_PARAM, required: false },
        ];
    }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema():  RestfulEndpoint.Schema | null { return null; }
}

export namespace GetAnalyticsFunnels
{
    export const URI : string = apiPath( "analytics", 1, "/funnels" );

    export interface Query
    {
        campaignId : string;
        from       : Analytics.QueryFilter[ "from" ];
        to         : Analytics.QueryFilter[ "to" ];
        channel?   : Analytics.Channel;
        variant?   : string;
    }

    export interface Response extends Analytics.Funnel {}

    export enum Error
    {
        BAD_REQUEST           = NetworkUtils.Status.BAD_REQUEST,
        UNAUTHORIZED          = NetworkUtils.Status.UNAUTHORIZED,
        INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR,
    }
}

export default GetAnalyticsFunnels;
// eof
