//
import { ScanCommand, type ScanCommandOutput } from "@aws-sdk/lib-dynamodb";
import { GetCatalog, Marketplace, Paging } from "@repo/api";
import { NetworkUtils, ResultUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";
import MarketplaceService from "../services/MarketplaceService";

//
// Browse the catalog — a full-table scan (the catalog is small + platform-global, not account-scoped;
// a category GSI exists for a future category-first browse but a flat scan is simplest for now),
// optionally filtered by category/vertical.
//
export class GetCatalogImpl extends GetCatalog
{
    private service : MarketplaceService;
    constructor( service : MarketplaceService ) { super(); this.service = service; }

    ////////////////////////////////////////////////////////////////////////////////////////////
    public async execute( _auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        const found : Type.Result<Array<Marketplace.IntegrationDefinition>> = await ResultUtils.from( async () : Promise<Array<Marketplace.IntegrationDefinition>> =>
        {
            const result : ScanCommandOutput = await this.service.dynamo.client.send( new ScanCommand( { TableName: this.service.dynamo.table( "catalog" ) } ) );
            return ( result.Items ?? [] ) as Array<Marketplace.IntegrationDefinition>;
        } );
        if( !found.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "catalog read failed" } };

        const query : GetCatalog.Query = this.query ?? {};
        const items : Array<Marketplace.IntegrationDefinition> = found.data
            .filter( ( row : Marketplace.IntegrationDefinition ) : boolean => query.category ? row.category === query.category : true )
            .filter( ( row : Marketplace.IntegrationDefinition ) : boolean => query.vertical ? row.verticals.includes( query.vertical ) : true )
            .sort( ( first : Marketplace.IntegrationDefinition, second : Marketplace.IntegrationDefinition ) : number => first.name.localeCompare( second.name ) );

        const paged : Paging.Result<Marketplace.IntegrationDefinition> = Paging.paginate( items, query );
        return { status: NetworkUtils.Status.OK, data: paged };
    }
}

export default GetCatalogImpl;
