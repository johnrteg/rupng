//
import { GetUsage, Marketplace } from "@repo/api";
import { NetworkUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";
import MarketplaceService from "../services/MarketplaceService";

//
// Account usage roll-up for one period — a simple SUM over that period's meter rows (no aggregate
// table). Filters the accountId partition's rows by the period suffix on `meterKey`.
//
export class GetUsageImpl extends GetUsage
{
    private service : MarketplaceService;
    constructor( service : MarketplaceService ) { super(); this.service = service; }

    ////////////////////////////////////////////////////////////////////////////////////////////
    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        if( !auth.userId )   return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };
        const accountId : string | undefined = auth.accountId;
        if( !accountId )     return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "no acting account (X-Account)" } };
        const period : string = this.query?.period ?? new Date().toISOString().slice( 0, 7 );

        const found : Type.Result<Array<Marketplace.UsageMeter>> = await this.service.dynamo.query<Marketplace.UsageMeter>( "usage_meters", {
            KeyConditionExpression:    "accountId = :a",
            ExpressionAttributeValues: { ":a": accountId },
        } );
        if( !found.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "usage read failed" } };

        const meters : Array<Marketplace.UsageMeter> = found.data.filter( ( row : Marketplace.UsageMeter ) : boolean => row.period === period );

        const byIntegration : Array<GetUsage.Counters & { integrationId : string }> = meters.map( ( row : Marketplace.UsageMeter ) => (
            { integrationId: row.integrationId, calls: row.calls, syncs: row.syncs, actions: row.actions, records: row.records }
        ) );

        const total : GetUsage.Counters = byIntegration.reduce( ( sum : GetUsage.Counters, row ) : GetUsage.Counters => ( {
            calls: sum.calls + row.calls, syncs: sum.syncs + row.syncs, actions: sum.actions + row.actions, records: sum.records + row.records,
        } ), { calls: 0, syncs: 0, actions: 0, records: 0 } );

        return { status: NetworkUtils.Status.OK, data: { period, byIntegration, total } };
    }
}

export default GetUsageImpl;
