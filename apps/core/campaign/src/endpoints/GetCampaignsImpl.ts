//
import { GetCampaigns, Campaign, Paging } from "@repo/api";
import { NetworkUtils, ObjectUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";
import CampaignService from "../services/CampaignService";

//
// List the acting account's campaigns. First cut: query the accountId partition, hydrate from the model
// DEFAULT, hide ARCHIVED unless a status filter asks otherwise.
//
export class GetCampaignsImpl extends GetCampaigns
{
    private service : CampaignService;
    constructor( service : CampaignService ) { super(); this.service = service; }

    ////////////////////////////////////////////////////////////////////////////////////////////
    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        if( !auth.userId )   return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };
        const accountId : string | undefined = auth.accountId;
        if( !accountId )     return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "no acting account (X-Account)" } };

        const found : Type.Result<Array<Campaign.Entity>> = await this.service.dynamo.query<Campaign.Entity>( "campaigns", {
            KeyConditionExpression:    "accountId = :a",
            ExpressionAttributeValues: { ":a": accountId },
        } );
        if( !found.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "campaigns read failed" } };

        const query : GetCampaigns.Query = this.query ?? {};
        const campaigns : Array<Campaign.Entity> = found.data
            .map( ( row : Campaign.Entity ) : Campaign.Entity => ObjectUtils.withDefaults( row, Campaign.DEFAULT ) )
            .filter( ( row : Campaign.Entity ) : boolean => query.status ? row.status === query.status : row.status !== Campaign.Status.ARCHIVED )
            .sort( ( first : Campaign.Entity, second : Campaign.Entity ) : number => String( second.createdAt ?? "" ).localeCompare( String( first.createdAt ?? "" ) ) );

        const paged : Paging.Result<Campaign.Entity> = Paging.paginate( campaigns, query );
        return { status: NetworkUtils.Status.OK, data: paged };
    }
}

export default GetCampaignsImpl;
