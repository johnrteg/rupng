//
import { randomUUID } from "node:crypto";

import { PostCampaign, Campaign } from "@repo/api";
import { NetworkUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";
import { Events, Payloads } from "@repo/system";
import CampaignService from "../services/CampaignService";

//
// Create a campaign in DRAFT state. Server assigns id / accountId / status / ownerId / timestamps; the stored
// row carries a `campaignId` sort-key mirroring `id`. Channels/strategies/plans may be supplied now or via PATCH.
//
export class PostCampaignImpl extends PostCampaign
{
    private service : CampaignService;
    constructor( service : CampaignService ) { super(); this.service = service; }

    ////////////////////////////////////////////////////////////////////////////////////////////
    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        if( !auth.userId )   return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };
        const accountId : string | undefined = auth.accountId;
        if( !accountId )     return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "no acting account (X-Account)" } };
        const name : string = this.body?.name ?? "";
        if( !name )          return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "name required" } };

        // allocate the per-account sequential reference number (immutable once set) BEFORE the write — a failed
        // allocation aborts the create so we never persist an unnumbered campaign
        const ref : Type.Result<number> = await this.service.nextRef( accountId, CampaignService.SequenceKind.CAMPAIGN );
        if( !ref.ok )        return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "campaign ref allocation failed" } };

        const now : Type.ISODateTime = new Date().toISOString();
        const id : Type.UUID = randomUUID();
        const entity : Campaign.Entity =
        {
            id,
            accountId,
            ref:       ref.data,
            name,
            objective: this.body?.objective,
            status:    Campaign.Status.DRAFT,
            channels:  this.body?.channels ?? [],
            audience:  this.body?.audience,
            budget:    this.body?.budget,
            palette:   this.body?.palette,
            fonts:     this.body?.fonts,
            svgs:      this.body?.svgs,
            ownerId:   auth.userId,
            createdAt: now,
            modifiedAt: now,
        };

        const wrote : Type.Result<void> = await this.service.dynamo.put( "campaigns", { ...entity, campaignId: id } );
        if( !wrote.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "campaign write failed" } };

        // best-effort CRUD event — never blocks the response
        const payload : Payloads.Campaign = { id: entity.id, accountId: entity.accountId, name: entity.name, status: entity.status };
        void this.service.emit( Events.Verb.CREATED, entity.id, accountId, payload, auth.userId );

        return { status: NetworkUtils.Status.OK, data: entity };
    }
}

export default PostCampaignImpl;
