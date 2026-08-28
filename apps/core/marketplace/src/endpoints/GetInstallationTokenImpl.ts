//
import { GetInstallationToken, Marketplace } from "@repo/api";
import { NetworkUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";
import { OAuth } from "@repo/oauth";
import MarketplaceService from "../services/MarketplaceService";

//
// S2S: resolve a fresh access token for an installation's connection. The broker auto-refreshes
// before expiry — the caller never sees a stale or raw stored credential.
//
export class GetInstallationTokenImpl extends GetInstallationToken
{
    private service : MarketplaceService;
    constructor( service : MarketplaceService ) { super(); this.service = service; }

    ////////////////////////////////////////////////////////////////////////////////////////////
    public async execute( _auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        const installationId : string = this.query?.id ?? "";
        if( !installationId ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "id required" } };

        const got : Type.Result<Marketplace.Installation | undefined> = await this.service.dynamo.get<Marketplace.Installation>( "installations", { installationId } );
        if( !got.ok )   return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "installation read failed" } };
        if( !got.data ) return { status: NetworkUtils.Status.NOT_FOUND, data: { message: "installation not found" } };

        const token : Type.Result<OAuth.Token> = await this.service.oauthFor( got.data.integrationId ).getToken( got.data.integrationId, installationId );
        if( !token.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "token resolution failed" } };

        return { status: NetworkUtils.Status.OK, data: { accessToken: token.data.accessToken, expiresAt: token.data.expiresAt } };
    }
}

export default GetInstallationTokenImpl;
