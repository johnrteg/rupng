//
import { GetCatalogItem, Marketplace } from "@repo/api";
import { NetworkUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";
import MarketplaceService from "../services/MarketplaceService";

//
// Fetch one catalog definition by id.
//
export class GetCatalogItemImpl extends GetCatalogItem
{
    private service : MarketplaceService;
    constructor( service : MarketplaceService ) { super(); this.service = service; }

    ////////////////////////////////////////////////////////////////////////////////////////////
    public async execute( _auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        const integrationId : string = this.query?.integrationId ?? "";
        if( !integrationId ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "integrationId required" } };

        const got : Type.Result<Marketplace.IntegrationDefinition | undefined> = await this.service.dynamo.get<Marketplace.IntegrationDefinition>( "catalog", { integrationId } );
        if( !got.ok )   return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "catalog read failed" } };
        if( !got.data ) return { status: NetworkUtils.Status.NOT_FOUND, data: { message: "integration not found" } };

        return { status: NetworkUtils.Status.OK, data: got.data };
    }
}

export default GetCatalogItemImpl;
