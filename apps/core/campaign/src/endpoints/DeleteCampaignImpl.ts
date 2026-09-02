//
import { DeleteCampaign, Campaign } from "@repo/api";
import { NetworkUtils, ObjectUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";
import { Events, Payloads } from "@repo/system";
import CampaignService from "../services/CampaignService";

//
// Archive a campaign (terminal, read-only — campaigns are archivable, never hard-deleted; run history +
// audience snapshot are preserved for audit). Status → ARCHIVED.
//
export class DeleteCampaignImpl extends DeleteCampaign
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
        const now : Type.ISODateTime = new Date().toISOString();
        const archived : Campaign.Entity = { ...current, status: Campaign.Status.ARCHIVED, modifiedAt: now };

        const wrote : Type.Result<void> = await this.service.dynamo.put( "campaigns", { ...archived, campaignId: id } );
        if( !wrote.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "campaign archive failed" } };

        // best-effort CRUD event — never blocks the response
        const payload : Payloads.Campaign = { id: archived.id, accountId: archived.accountId, name: archived.name, status: archived.status };
        void this.service.emit( Events.Verb.DELETED, archived.id, accountId, payload, auth.userId );

        return { status: NetworkUtils.Status.OK, data: { id, archived: true } };
    }
}

export default DeleteCampaignImpl;
