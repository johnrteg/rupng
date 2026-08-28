//
import MarketplaceService from "./MarketplaceService";

import PostInstallationImpl from "../endpoints/PostInstallationImpl";
import GetInstallationTokenImpl from "../endpoints/GetInstallationTokenImpl";
import DeleteInstallationImpl from "../endpoints/DeleteInstallationImpl";
import GetCatalogImpl from "../endpoints/GetCatalogImpl";
import GetCatalogItemImpl from "../endpoints/GetCatalogItemImpl";
import PostCatalogImpl from "../endpoints/PostCatalogImpl";
import PatchCatalogImpl from "../endpoints/PatchCatalogImpl";
import GetInstallationsImpl from "../endpoints/GetInstallationsImpl";
import GetInstallationImpl from "../endpoints/GetInstallationImpl";
import PostInstallationEnableImpl from "../endpoints/PostInstallationEnableImpl";
import PatchInstallationImpl from "../endpoints/PatchInstallationImpl";
import PostInstallationPauseImpl from "../endpoints/PostInstallationPauseImpl";
import PostInstallationResumeImpl from "../endpoints/PostInstallationResumeImpl";
import PostInstallationConnectImpl from "../endpoints/PostInstallationConnectImpl";
import PostInstallationReauthImpl from "../endpoints/PostInstallationReauthImpl";
import UninstallInstallationImpl from "../endpoints/UninstallInstallationImpl";
import GetInstallationHealthImpl from "../endpoints/GetInstallationHealthImpl";
import PostInstallationHealthCheckImpl from "../endpoints/PostInstallationHealthCheckImpl";
import PostInternalUsageImpl from "../endpoints/PostInternalUsageImpl";
import GetUsageImpl from "../endpoints/GetUsageImpl";
import GetInstallationUsageImpl from "../endpoints/GetInstallationUsageImpl";
import PostInternalActionImpl from "../endpoints/PostInternalActionImpl";

//
// MAIN role — the internal `/marketplace/internal/*` installations API a consuming service (e.g.
// social) calls S2S to create a connection and resolve a fresh token, the `/marketplace/catalog`
// browse/manage API, and the account-facing `/marketplace/installations/*` lifecycle API
// (enable/list/detail/patch/pause/resume/connect/reauth/uninstall). The OAuth callback endpoint
// (`GET /marketplace/oauth/callback`) is a later addition.
//
export class MarketplaceMainService extends MarketplaceService
{
    ////////////////////////////////////////////////////////////////////////////////////////////
    constructor()
    {
        super( MarketplaceService.Role.MAIN );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** Register the marketplace endpoint impls (after the inherited /health + /version). */
    protected override async registerEndpoints() : Promise<void>
    {
        await super.registerEndpoints();          // keeps /health + /version
        this.register( new PostInstallationImpl( this ) );
        this.register( new GetInstallationTokenImpl( this ) );
        this.register( new DeleteInstallationImpl( this ) );
        this.register( new GetCatalogImpl( this ) );
        this.register( new GetCatalogItemImpl( this ) );
        this.register( new PostCatalogImpl( this ) );
        this.register( new PatchCatalogImpl( this ) );
        this.register( new GetInstallationsImpl( this ) );
        this.register( new GetInstallationImpl( this ) );
        this.register( new PostInstallationEnableImpl( this ) );
        this.register( new PatchInstallationImpl( this ) );
        this.register( new PostInstallationPauseImpl( this ) );
        this.register( new PostInstallationResumeImpl( this ) );
        this.register( new PostInstallationConnectImpl( this ) );
        this.register( new PostInstallationReauthImpl( this ) );
        this.register( new UninstallInstallationImpl( this ) );
        this.register( new GetInstallationHealthImpl( this ) );
        this.register( new PostInstallationHealthCheckImpl( this ) );
        this.register( new PostInternalUsageImpl( this ) );
        this.register( new GetUsageImpl( this ) );
        this.register( new GetInstallationUsageImpl( this ) );
        this.register( new PostInternalActionImpl( this ) );
    }
}

export default MarketplaceMainService;
