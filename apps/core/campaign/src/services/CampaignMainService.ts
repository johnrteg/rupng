//
import CampaignService from "./CampaignService";

import GetCampaignsImpl from "../endpoints/GetCampaignsImpl";
import GetInternalCampaignsImpl from "../endpoints/GetInternalCampaignsImpl";
import GetCampaignImpl from "../endpoints/GetCampaignImpl";
import PostCampaignImpl from "../endpoints/PostCampaignImpl";
import PatchCampaignImpl from "../endpoints/PatchCampaignImpl";
import DeleteCampaignImpl from "../endpoints/DeleteCampaignImpl";

//
// MAIN role — the /campaign/* API (campaign CRUD + lifecycle, initial cut). Single deployable role.
//
export class CampaignMainService extends CampaignService
{
    ////////////////////////////////////////////////////////////////////////////////////////////
    constructor()
    {
        super( CampaignService.Role.MAIN );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** Register the campaign endpoint impls (after the inherited /health + /version). */
    protected override async registerEndpoints() : Promise<void>
    {
        await super.registerEndpoints();          // keeps /health + /version
        this.register( new GetCampaignsImpl( this ) );
        this.register( new GetInternalCampaignsImpl( this ) );
        this.register( new GetCampaignImpl( this ) );
        this.register( new PostCampaignImpl( this ) );
        this.register( new PatchCampaignImpl( this ) );
        this.register( new DeleteCampaignImpl( this ) );
    }
}

export default CampaignMainService;
