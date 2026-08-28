//
import { GetInstallationUsage, Marketplace } from "@repo/api";
import { NetworkUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";
import MarketplaceService from "../services/MarketplaceService";

//
// Per-instance usage counters, one row per period.
//
export class GetInstallationUsageImpl extends GetInstallationUsage
{
    private service : MarketplaceService;
    constructor( service : MarketplaceService ) { super(); this.service = service; }

    ////////////////////////////////////////////////////////////////////////////////////////////
    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        if( !auth.userId )   return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };
        const accountId : string | undefined = auth.accountId;
        if( !accountId )     return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "no acting account (X-Account)" } };
        const installationId : string = this.query?.id ?? "";
        if( !installationId ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "id required" } };

        const installation : Type.Result<Marketplace.Installation | undefined> = await this.service.dynamo.get<Marketplace.Installation>( "installations", { installationId } );
        if( !installation.ok )   return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "installation read failed" } };
        if( !installation.data || installation.data.accountId !== accountId ) return { status: NetworkUtils.Status.NOT_FOUND, data: { message: "installation not found" } };
        const target : Marketplace.Installation = installation.data;

        const found : Type.Result<Array<Marketplace.UsageMeter>> = await this.service.dynamo.query<Marketplace.UsageMeter>( "usage_meters", {
            KeyConditionExpression:    "accountId = :a",
            ExpressionAttributeValues: { ":a": accountId },
        } );
        if( !found.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "usage read failed" } };

        const meters : Array<Marketplace.UsageMeter> = found.data
            .filter( ( row : Marketplace.UsageMeter ) : boolean => row.integrationId === target.integrationId && row.instanceId === target.instanceId )
            .sort( ( first : Marketplace.UsageMeter, second : Marketplace.UsageMeter ) : number => second.period.localeCompare( first.period ) );

        return { status: NetworkUtils.Status.OK, data: { meters } };
    }
}

export default GetInstallationUsageImpl;
