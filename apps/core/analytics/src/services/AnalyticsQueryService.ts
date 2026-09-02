//
import AnalyticsService from "./AnalyticsService";
import GetAnalyticsMetricsImpl from "../endpoints/GetAnalyticsMetricsImpl";
import GetAnalyticsFunnelsImpl from "../endpoints/GetAnalyticsFunnelsImpl";
import GetAnalyticsEngagementImpl from "../endpoints/GetAnalyticsEngagementImpl";
import GetAnalyticsDeliverabilityImpl from "../endpoints/GetAnalyticsDeliverabilityImpl";
import PostAnalyticsReprocessImpl from "../endpoints/PostAnalyticsReprocessImpl";

//
// AnalyticsQueryService — analytics' ONLY HTTP role (SPECS.md "Service & Job topology"): the
// RBAC-scoped Query API, reading from the rollups table (live) — Athena/historical isn't built yet
// (see the SPECS gap register). Ships the A/B-priority read endpoints (analytics-5/7); the rest of
// the "Endpoints (first cut)" table (behavior/cohorts/benchmarks/attribution/schema) is deferred.
//
export class AnalyticsQueryService extends AnalyticsService
{
    ////////////////////////////////////////////////////////////////////////////////////////////
    constructor()
    {
        super( AnalyticsService.Role.MAIN );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    protected override async registerEndpoints() : Promise<void>
    {
        await super.registerEndpoints();   // keeps /health + /version
        this.register( new GetAnalyticsMetricsImpl( this ) );
        this.register( new GetAnalyticsFunnelsImpl( this ) );
        this.register( new GetAnalyticsEngagementImpl( this ) );
        this.register( new GetAnalyticsDeliverabilityImpl( this ) );
        this.register( new PostAnalyticsReprocessImpl( this ) );
    }
}

export default AnalyticsQueryService;
// eof
