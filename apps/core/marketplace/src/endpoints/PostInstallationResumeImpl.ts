//
import { PostInstallationResume, Marketplace } from "@repo/api";
import { NetworkUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";
import MarketplaceService from "../services/MarketplaceService";

//
// Resume a paused installation.
//
export class PostInstallationResumeImpl extends PostInstallationResume
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
        if( got.data.status !== Marketplace.InstallStatus.PAUSED )
            return { status: NetworkUtils.Status.CONFLICT, data: { message: "installation isn't paused" } };

        const resumed : Marketplace.Installation = { ...got.data, status: Marketplace.InstallStatus.ACTIVE, disabledAt: undefined };
        const wrote : Type.Result<void> = await this.service.dynamo.put( "installations", { ...resumed } );
        if( !wrote.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "installation write failed" } };

        await this.service.appendAudit( installationId, Marketplace.InstallationAuditAction.RESUME, auth.userId );

        return { status: NetworkUtils.Status.OK, data: resumed };
    }
}

export default PostInstallationResumeImpl;
