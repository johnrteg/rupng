//
import { DeleteInstallation, Marketplace } from "@repo/api";
import { NetworkUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";
import MarketplaceService from "../services/MarketplaceService";

//
// S2S: uninstall — revoke upstream where the broker supports it, then mark the installation REMOVED
// (never hard-deleted; consistent with the platform's archive-vs-GDPR rules).
//
export class DeleteInstallationImpl extends DeleteInstallation
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

        const revoked : Type.Result<void> = await this.service.oauthFor( got.data.integrationId ).disconnect( got.data.integrationId, installationId );
        if( !revoked.ok ) this.service.log.warn( "installation revoke failed (removing anyway)", { installationId, error: revoked.error } );

        const now : Type.ISODateTime = new Date().toISOString();
        const removed : Marketplace.Installation = { ...got.data, status: Marketplace.InstallStatus.REMOVED, disabledAt: now };
        const wrote : Type.Result<void> = await this.service.dynamo.put( "installations", { ...removed } );
        if( !wrote.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "installation removal write failed" } };

        return { status: NetworkUtils.Status.OK, data: { installationId, removed: true } };
    }
}

export default DeleteInstallationImpl;
