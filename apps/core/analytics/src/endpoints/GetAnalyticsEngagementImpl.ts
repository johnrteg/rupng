//
import { GetAnalyticsEngagement, Analytics } from "@repo/api";
import { NetworkUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";
import AnalyticsService from "../services/AnalyticsService";

// the engagement-taxonomy verbs (see AnalyticsModel.ts's EventType) — GetAnalyticsMetrics answers
// the general case; this endpoint narrows to the "did they engage" subset (analytics-7.1).
const ENGAGEMENT_EVENT_TYPES : Array<string> = [ Analytics.EventType.OPENED, Analytics.EventType.CLICKED, Analytics.EventType.REPLIED ];

//
// Cross-channel engagement (analytics-7.1) — account/campaign scope only; see GetAnalyticsEngagement's
// docs for why contact-level drill-down is deferred.
//
export class GetAnalyticsEngagementImpl extends GetAnalyticsEngagement
{
    private service : AnalyticsService;
    constructor( service : AnalyticsService ) { super(); this.service = service; }

    ////////////////////////////////////////////////////////////////////////////////////////////
    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        const accountId : string | undefined = auth.accountId;
        if( !accountId ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "no acting account (X-Account)" } };

        const found : Type.Result<Array<Analytics.Rollup>> = await this.service.queryRollups( accountId, {
            channel: this.query?.channel, campaignId: this.query?.campaignId,
            granularity: this.query?.granularity, from: this.query?.from, to: this.query?.to,
        } );
        if( !found.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "engagement read failed" } };

        const rows : Array<Analytics.MetricRow> = found.data
            .filter( ( row : Analytics.Rollup ) : boolean => ENGAGEMENT_EVENT_TYPES.includes( row.dimensions.eventType as string ) )
            .map( ( row : Analytics.Rollup ) : Analytics.MetricRow => ( { periodStart: row.periodStart, dimensions: row.dimensions, count: row.count } ) );
        return { status: NetworkUtils.Status.OK, data: { data: rows } };
    }
}

export default GetAnalyticsEngagementImpl;
// eof
