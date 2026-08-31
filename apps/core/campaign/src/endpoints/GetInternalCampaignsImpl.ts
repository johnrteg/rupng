//
import { GetInternalCampaigns, Campaign, Paging } from "@repo/api";
import { NetworkUtils, ObjectUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";
import CampaignService from "../services/CampaignService";

//
// S2S: list an EXPLICIT account's campaigns. Same read/hydrate/filter/sort/page shape as GetCampaignsImpl,
// but the account comes from the query param (no user session on an S2S call) and there is no RBAC check.
//
export class GetInternalCampaignsImpl extends GetInternalCampaigns
{
    private service : CampaignService;
    constructor( service : CampaignService ) { super(); this.service = service; }

    ////////////////////////////////////////////////////////////////////////////////////////////
    public async execute( _auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        const query : GetInternalCampaigns.Query | undefined = this.query;
        const accountId : string | undefined = query?.accountId;
        if( !accountId ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "accountId is required" } };

        // read every campaign on the requested account's partition
        const found : Type.Result<Array<Campaign.Entity>> = await this.service.dynamo.query<Campaign.Entity>( "campaigns", {
            KeyConditionExpression:    "accountId = :a",
            ExpressionAttributeValues: { ":a": accountId },
        } );
        if( !found.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "campaigns read failed" } };

        // hydrate + filter + sort: an explicit status filter wins; otherwise hide ARCHIVED, newest first
        const campaigns : Array<Campaign.Entity> = found.data
            .map( ( row : Campaign.Entity ) : Campaign.Entity => ObjectUtils.withDefaults( row, Campaign.DEFAULT ) )
            .filter( ( row : Campaign.Entity ) : boolean => query?.status ? row.status === query.status : row.status !== Campaign.Status.ARCHIVED )
            .sort( ( first : Campaign.Entity, second : Campaign.Entity ) : number => String( second.createdAt ?? "" ).localeCompare( String( first.createdAt ?? "" ) ) );

        // page the filtered set (in-memory) into the standard { records, page } envelope
        const paged : Paging.Result<Campaign.Entity> = Paging.paginate( campaigns, query ?? { accountId } );
        return { status: NetworkUtils.Status.OK, data: paged };
    }
}

export default GetInternalCampaignsImpl;
// eof
