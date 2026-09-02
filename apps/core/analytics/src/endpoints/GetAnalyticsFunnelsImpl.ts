//
import { GetAnalyticsFunnels, Analytics } from "@repo/api";
import { NetworkUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";
import AnalyticsService from "../services/AnalyticsService";

// the funnel's fixed stage order (SPECS.md "What analytics answers") — a stage with no rollup row
// in the window still appears with count 0 (never silently dropped, or the rates downstream would
// misread a missing stage as "0 total" instead of "0 conversions").
const STAGES : Array<Analytics.EventType> =
[ Analytics.EventType.SENT, Analytics.EventType.DELIVERED, Analytics.EventType.OPENED, Analytics.EventType.CLICKED, Analytics.EventType.CONVERTED ];

//
// Funnel stages (analytics-7.2) — one campaign, summed over the window. Always reads the "day"
// granularity rollups (both "hour" and "day" rows exist for the same events — summing across BOTH
// would double-count).
//
export class GetAnalyticsFunnelsImpl extends GetAnalyticsFunnels
{
    private service : AnalyticsService;
    constructor( service : AnalyticsService ) { super(); this.service = service; }

    ////////////////////////////////////////////////////////////////////////////////////////////
    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        const accountId : string | undefined = auth.accountId;
        if( !accountId ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "no acting account (X-Account)" } };
        const campaignId : string = this.query?.campaignId ?? "";
        if( !campaignId ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "campaignId required" } };

        const found : Type.Result<Array<Analytics.Rollup>> = await this.service.queryRollups( accountId, {
            channel: this.query?.channel, campaignId, granularity: "day", from: this.query?.from, to: this.query?.to,
        } );
        if( !found.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "funnel read failed" } };

        // sum every matching row's count per stage (multiple periods/providers can share a stage)
        const totals : Map<Analytics.EventType, number> = new Map();
        for( const row of found.data )
        {
            const stage : Analytics.EventType | undefined = STAGES.find( ( type : Analytics.EventType ) : boolean => type === row.dimensions.eventType );
            if( stage === undefined ) continue;
            totals.set( stage, ( totals.get( stage ) ?? 0 ) + row.count );
        }

        // rate = this stage's count / the PRIOR stage's count (the first stage's rate is 1 unless it's empty)
        const stages : Array<Analytics.FunnelStage> = [];
        let previous : number | undefined = undefined;
        for( const stage of STAGES )
        {
            const count : number = totals.get( stage ) ?? 0;
            const rate  : number = previous === undefined ? 1 : ( previous > 0 ? count / previous : 0 );
            stages.push( { stage, count, rate } );
            previous = count;
        }

        return { status: NetworkUtils.Status.OK, data: { campaignId, variant: this.query?.variant, stages } };
    }
}

export default GetAnalyticsFunnelsImpl;
// eof
