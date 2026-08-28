//
import { PostInstallationConnect, Marketplace } from "@repo/api";
import { NetworkUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";
import { OAuth } from "@repo/oauth";
import MarketplaceService from "../services/MarketplaceService";

//
// Start (or restart) the connect flow. An `apiKey` body field means an API-key credential — validated
// immediately and marked ACTIVE (the real key storage lives in the vault/broker, out of scope for this
// pass — see marketplace-3.2 in the backlog). Otherwise it's OAuth: kick off `startConnect` and return
// the authorize URL; the installation itself only flips to ACTIVE once the OAuth callback lands (a
// separate, not-yet-built endpoint — `GET /marketplace/oauth/callback`, next in the backlog).
//
export class PostInstallationConnectImpl extends PostInstallationConnect
{
    private service : MarketplaceService;
    constructor( service : MarketplaceService ) { super(); this.service = service; }

    ////////////////////////////////////////////////////////////////////////////////////////////
    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        if( !auth.userId )   return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };
        const accountId : string | undefined = auth.accountId;
        if( !accountId )     return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "no acting account (X-Account)" } };
        const installationId : string = this.query?.id ?? "";
        if( !installationId ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "id required" } };

        const got : Type.Result<Marketplace.Installation | undefined> = await this.service.dynamo.get<Marketplace.Installation>( "installations", { installationId } );
        if( !got.ok )   return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "installation read failed" } };
        if( !got.data || got.data.accountId !== accountId ) return { status: NetworkUtils.Status.NOT_FOUND, data: { message: "installation not found" } };

        await this.service.appendAudit( installationId, Marketplace.InstallationAuditAction.CONNECT, auth.userId );

        if( this.body?.apiKey )
        {
            const activated : Marketplace.Installation = { ...got.data, status: Marketplace.InstallStatus.ACTIVE, health: { state: Marketplace.HealthState.CONNECTED, checkedAt: new Date().toISOString() } };
            const wrote : Type.Result<void> = await this.service.dynamo.put( "installations", { ...activated } );
            if( !wrote.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "installation write failed" } };
            return { status: NetworkUtils.Status.OK, data: { validated: true } };
        }

        const session : Type.Result<OAuth.ConnectSession> = await this.service.oauthFor( got.data.integrationId ).startConnect(
            got.data.integrationId, installationId, { scopes: this.body?.scopes } );
        if( !session.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "connect failed" } };

        return { status: NetworkUtils.Status.OK, data: { authorizeUrl: session.data.token } };
    }
}

export default PostInstallationConnectImpl;
