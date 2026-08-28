//
import { PatchCatalog, Marketplace } from "@repo/api";
import { NetworkUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";
import MarketplaceService from "../services/MarketplaceService";

//
// Edit a catalog definition — APPLICATION-gated. Merges the patch onto the stored definition, then
// re-validates the full result before persisting.
//
export class PatchCatalogImpl extends PatchCatalog
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

        const patched : Marketplace.IntegrationDefinition = { ...got.data, ...( this.body ?? {} ), integrationId };
        if( !Marketplace.validateCatalog( patched ) ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "invalid integration definition" } };

        const wrote : Type.Result<void> = await this.service.dynamo.put( "catalog", { ...patched } );
        if( !wrote.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "catalog write failed" } };

        return { status: NetworkUtils.Status.OK, data: patched };
    }
}

export default PatchCatalogImpl;
