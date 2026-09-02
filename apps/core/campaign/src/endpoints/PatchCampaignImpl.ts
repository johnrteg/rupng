//
import { PatchCampaign, Campaign } from "@repo/api";
import { NetworkUtils, ObjectUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";
import { Events, Payloads } from "@repo/system";
import CampaignService from "../services/CampaignService";

//
// Edit a campaign's definition / channels / strategies / plans — draft only (content freezes once submitted).
// Merges the supplied subset over the current record, bumps modifiedAt. Identity/accountId/status/owner stay
// server-owned (lifecycle transitions are their own endpoints).
//
export class PatchCampaignImpl extends PatchCampaign
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

        const current : Campaign.Entity = ObjectUtils.withDefaults( got.data, Campaign.DEFAULT );
        // content freezes once out of DRAFT (edits require a changes-requested → resubmit cycle)
        if( current.status !== Campaign.Status.DRAFT )
            return { status: NetworkUtils.Status.CONFLICT, data: { message: "campaign is locked (submitted / in review)" } };

        const now : Type.ISODateTime = new Date().toISOString();
        const merged : Campaign.Entity =
        {
            ...current,
            ...this.body,
            id:         current.id,
            accountId:  current.accountId,
            status:     current.status,
            ownerId:    current.ownerId,
            createdAt:  current.createdAt,
            modifiedAt: now,
        };

        const wrote : Type.Result<void> = await this.service.dynamo.put( "campaigns", { ...merged, campaignId: id } );
        if( !wrote.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "campaign write failed" } };

        // best-effort CRUD event — never blocks the response
        const payload : Payloads.Campaign = { id: merged.id, accountId: merged.accountId, name: merged.name, status: merged.status };
        void this.service.emit( Events.Verb.UPDATED, merged.id, accountId, payload, auth.userId );

        return { status: NetworkUtils.Status.OK, data: merged };
    }
}

export default PatchCampaignImpl;
