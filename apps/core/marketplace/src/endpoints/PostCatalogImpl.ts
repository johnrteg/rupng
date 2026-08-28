//
import { PostCatalog, Marketplace } from "@repo/api";
import { NetworkUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";
import MarketplaceService from "../services/MarketplaceService";

//
// Create a catalog definition (platform-global) — APPLICATION-gated. Validates against
// Marketplace.CATALOG_SCHEMA before persisting.
//
export class PostCatalogImpl extends PostCatalog
{
    private service : MarketplaceService;
    constructor( service : MarketplaceService ) { super(); this.service = service; }

    ////////////////////////////////////////////////////////////////////////////////////////////
    public async execute( _auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        const definition : Marketplace.IntegrationDefinition | null = this.body;
        if( !definition ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "definition required" } };
        if( !Marketplace.validateCatalog( definition ) ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "invalid integration definition" } };

        const wrote : Type.Result<void> = await this.service.dynamo.put( "catalog", { ...definition } );
        if( !wrote.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "catalog write failed" } };

        return { status: NetworkUtils.Status.OK, data: definition };
    }
}

export default PostCatalogImpl;
