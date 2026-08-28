//
import { GetInstallations, Marketplace, Paging } from "@repo/api";
import { NetworkUtils, ObjectUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";
import MarketplaceService from "../services/MarketplaceService";

//
// List the acting account's installations via the `byAccount` GSI.
//
export class GetInstallationsImpl extends GetInstallations
{
    private service : MarketplaceService;
    constructor( service : MarketplaceService ) { super(); this.service = service; }

    ////////////////////////////////////////////////////////////////////////////////////////////
    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        if( !auth.userId )   return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };
        const accountId : string | undefined = auth.accountId;
        if( !accountId )     return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "no acting account (X-Account)" } };

        const found : Type.Result<Array<Marketplace.Installation>> = await this.service.dynamo.query<Marketplace.Installation>( "installations", {
            IndexName:                 "byAccount",
            KeyConditionExpression:    "accountId = :a",
            ExpressionAttributeValues: { ":a": accountId },
        } );
        if( !found.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "installations read failed" } };

        const query : GetInstallations.Query = this.query ?? {};
        const installations : Array<Marketplace.Installation> = found.data
            .map( ( row : Marketplace.Installation ) : Marketplace.Installation => ObjectUtils.withDefaults( row, Marketplace.DEFAULT ) )
            .filter( ( row : Marketplace.Installation ) : boolean => query.status ? row.status === query.status : true )
            .sort( ( first : Marketplace.Installation, second : Marketplace.Installation ) : number => second.installedAt.localeCompare( first.installedAt ) );

        const paged : Paging.Result<Marketplace.Installation> = Paging.paginate( installations, query );
        return { status: NetworkUtils.Status.OK, data: paged };
    }
}

export default GetInstallationsImpl;
