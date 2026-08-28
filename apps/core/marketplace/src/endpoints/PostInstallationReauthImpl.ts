//
import { PostInstallationReauth, Marketplace } from "@repo/api";
import { NetworkUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";
import { OAuth } from "@repo/oauth";
import MarketplaceService from "../services/MarketplaceService";

//
// Re-trigger OAuth when health is needs-reauth.
//
export class PostInstallationReauthImpl extends PostInstallationReauth
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

        const session : Type.Result<OAuth.ConnectSession> = await this.service.oauthFor( got.data.integrationId ).startConnect( got.data.integrationId, installationId );
        if( !session.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "reauth failed" } };

        await this.service.appendAudit( installationId, Marketplace.InstallationAuditAction.REAUTH, auth.userId );

        return { status: NetworkUtils.Status.OK, data: { authorizeUrl: session.data.token } };
    }
}

export default PostInstallationReauthImpl;
