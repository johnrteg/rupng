//
import { GetAnalyticsDeliverability, Analytics } from "@repo/api";
import { NetworkUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";
import AnalyticsService from "../services/AnalyticsService";

//
// Deliverability by provider/channel (analytics-7.4) — always reads the "day" granularity rollups
// (see GetAnalyticsFunnelsImpl for why: summing "hour" + "day" rows together would double-count).
// Per-domain breakdown is deferred (see GetAnalyticsDeliverability's docs) — `domain` is always
// omitted from the response today.
//
export class GetAnalyticsDeliverabilityImpl extends GetAnalyticsDeliverability
{
    private service : AnalyticsService;
    constructor( service : AnalyticsService ) { super(); this.service = service; }

    ////////////////////////////////////////////////////////////////////////////////////////////
    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        const accountId : string | undefined = auth.accountId;
        if( !accountId ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "no acting account (X-Account)" } };

        const found : Type.Result<Array<Analytics.Rollup>> = await this.service.queryRollups( accountId, {
            channel: this.query?.channel, provider: this.query?.provider, granularity: "day", from: this.query?.from, to: this.query?.to,
        } );
        if( !found.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "deliverability read failed" } };

        // one bucket per (provider, channel), summing the deliverability-relevant event types
        const buckets : Map<string, Analytics.Deliverability> = new Map();
        for( const row of found.data )
        {
            const provider : Analytics.Provider = row.dimensions.provider ?? "unknown";
            const channel  : Analytics.Channel  = row.dimensions.channel  ?? "unknown";
            const key : string = `${ provider }#${ channel }`;
            const bucket : Analytics.Deliverability = buckets.get( key ) ?? { provider, channel, sent: 0, delivered: 0, bounced: 0, complained: 0, failed: 0 };

            switch( row.dimensions.eventType )
            {
                case Analytics.EventType.SENT:            bucket.sent += row.count; break;
                case Analytics.EventType.DELIVERED:       bucket.delivered += row.count; break;
                case Analytics.EventType.BOUNCED:         bucket.bounced += row.count; break;
                case Analytics.EventType.COMPLAINED:      bucket.complained += row.count; break;
                case Analytics.EventType.DELIVERY_FAILED: bucket.failed += row.count; break;
                default: break;   // not a deliverability-relevant verb (e.g. opened/clicked) — ignored here
            }
            buckets.set( key, bucket );
        }

        return { status: NetworkUtils.Status.OK, data: { data: Array.from( buckets.values() ) } };
    }
}

export default GetAnalyticsDeliverabilityImpl;
// eof
