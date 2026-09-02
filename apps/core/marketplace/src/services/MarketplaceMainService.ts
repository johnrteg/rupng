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
import PostMarketplaceWebhookImpl from "../endpoints/PostMarketplaceWebhookImpl";

//
// MAIN role — the internal `/marketplace/internal/*` installations API a consuming service (e.g.
// social) calls S2S to create a connection and resolve a fresh token, the `/marketplace/catalog`
// browse/manage API, the account-facing `/marketplace/installations/*` lifecycle API
// (enable/list/detail/patch/pause/resume/connect/reauth/uninstall), and inbound 3rd-party webhook
// intake (`/marketplace/webhooks/:integrationId` — the connector runtime's front door). Webhook intake
// lives here rather than a dedicated `MarketplaceWebhookService` role for the SAME reason social's does
// (one ALB per manifest — see PostMarketplaceWebhookImpl). The OAuth callback endpoint
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
    // REPLACES the base's `formbody`-only registration — captures true raw bytes for
    // `PostMarketplaceWebhookImpl`'s connector `verifyWebhook` check (Shopify's HMAC scheme), mirroring
    // social's identical override for its own Meta webhook.
    protected override addServerRegister() : void { this.enableRawBodyCapture(); }

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
        this.register( new PostMarketplaceWebhookImpl( this ) );
    }
}

export default MarketplaceMainService;
