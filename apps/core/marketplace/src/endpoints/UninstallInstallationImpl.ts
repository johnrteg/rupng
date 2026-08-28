//
import { UninstallInstallation, Marketplace } from "@repo/api";
import { NetworkUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";
import { Events } from "@repo/services";
import MarketplaceService from "../services/MarketplaceService";

//
// Uninstall — revoke upstream where supported, mark REMOVED (never hard-deleted).
//
export class UninstallInstallationImpl extends UninstallInstallation
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

        const revoked : Type.Result<void> = await this.service.oauthFor( got.data.integrationId ).disconnect( got.data.integrationId, installationId );
        if( !revoked.ok ) this.service.log.warn( "installation revoke failed (removing anyway)", { installationId, error: revoked.error } );

        const removed : Marketplace.Installation = { ...got.data, status: Marketplace.InstallStatus.REMOVED, disabledAt: new Date().toISOString() };
        const wrote : Type.Result<void> = await this.service.dynamo.put( "installations", { ...removed } );
        if( !wrote.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "installation write failed" } };

        await this.service.appendAudit( installationId, Marketplace.InstallationAuditAction.UNINSTALL, auth.userId );
        await this.service.emitInstallationEvent( Events.Verb.DELETED, removed );

        return { status: NetworkUtils.Status.OK, data: { id: installationId, removed: true } };
    }
}

export default UninstallInstallationImpl;
