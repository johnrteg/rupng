//
import { GetCampaign, Campaign } from "@repo/api";
import { NetworkUtils, ObjectUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";
import CampaignService from "../services/CampaignService";

//
// Fetch a single campaign by id (tenant-scoped). The table SK is `campaignId`; the wire model exposes `id`.
//
export class GetCampaignImpl extends GetCampaign
{
    private service : CampaignService;
    constructor( service : CampaignService ) { super(); this.service = service; }

    ////////////////////////////////////////////////////////////////////////////////////////////
    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        if( !auth.userId )   return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };
        const accountId : string | undefined = auth.accountId;
        if( !accountId )     return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "no acting account (X-Account)" } };
        const id : string = this.query?.id ?? "";
        if( !id )            return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "id required" } };

        const got : Type.Result<Campaign.Entity | undefined> = await this.service.dynamo.get<Campaign.Entity>( "campaigns", { accountId, campaignId: id } );
        if( !got.ok )   return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "campaign read failed" } };
        if( !got.data ) return { status: NetworkUtils.Status.NOT_FOUND, data: { message: "campaign not found" } };

        return { status: NetworkUtils.Status.OK, data: ObjectUtils.withDefaults( got.data, Campaign.DEFAULT ) };
    }
}

export default GetCampaignImpl;
