//
import { GetAnalyticsMetrics, Analytics } from "@repo/api";
import { NetworkUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";
import AnalyticsService from "../services/AnalyticsService";

//
// Aggregate metrics (analytics-5.1/7.1) — thin translation over AnalyticsService.queryRollups.
//
export class GetAnalyticsMetricsImpl extends GetAnalyticsMetrics
{
    private service : AnalyticsService;
    constructor( service : AnalyticsService ) { super(); this.service = service; }

    ////////////////////////////////////////////////////////////////////////////////////////////
    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        const accountId : string | undefined = auth.accountId;
        if( !accountId ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "no acting account (X-Account)" } };

        const found : Type.Result<Array<Analytics.Rollup>> = await this.service.queryRollups( accountId, {
            channel: this.query?.channel, campaignId: this.query?.campaignId, eventType: this.query?.eventType,
            granularity: this.query?.granularity, from: this.query?.from, to: this.query?.to,
        } );
        if( !found.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "metrics read failed" } };

        const rows : Array<Analytics.MetricRow> = found.data.map( ( row : Analytics.Rollup ) : Analytics.MetricRow => (
            { periodStart: row.periodStart, dimensions: row.dimensions, count: row.count } ) );
        return { status: NetworkUtils.Status.OK, data: { data: rows } };
    }
}

export default GetAnalyticsMetricsImpl;
// eof
