//
import { NetworkUtils, ResultUtils, type Type } from "@repo/common";
import { RestfulService } from "@repo/endpoint";
import { Ports } from "@repo/services";
import { PostInstallation, GetInstallationToken, DeleteInstallation } from "@repo/api";

//
// MarketplaceClient — the S2S client to marketplace's internal installations API, shared by BOTH
// runtimes (`SocialService`'s HTTP roles and `SocialJob`'s Lambda workers), the same way `MediaJob` and
// `MediaService` share `MediaPipeline`. No service registry exists yet (see @repo/oauth's README) —
// base URL is `MARKETPLACE_INTERNAL_URL` (the internal ALB DNS in deployed envs), falling back to
// marketplace's local-dev port for `tsx watch`/LocalStack.
//
export class MarketplaceClient
{
    private readonly client : RestfulService;

    ////////////////////////////////////////////////////////////////////////////////////////////
    constructor()
    {
        this.client = new RestfulService(
            process.env.MARKETPLACE_INTERNAL_URL ?? NetworkUtils.url( NetworkUtils.Protocol.HTTP, "localhost", Ports.MARKETPLACE.MAIN, null, null ) );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** Create a marketplace installation for `integrationId` (the platform) and start its connect flow. */
    public async connect( accountId : Type.UUID, integrationId : string, installedBy : Type.UUID, scopes? : Array<string> ) : Promise<Type.Result<PostInstallation.Response>>
    {
        const reply : RestfulService.Reply<PostInstallation.Response> = await this.client.fetch( new PostInstallation( { accountId, integrationId, installedBy, scopes } ) );
        if( !reply.ok ) return ResultUtils.err( `marketplace connect failed (${ reply.status })` );
        return ResultUtils.ok( reply.data as PostInstallation.Response );
    }

    /** Resolve a fresh access token for a marketplace installation. */
    public async token( installationId : Type.UUID ) : Promise<Type.Result<GetInstallationToken.Response>>
    {
        const reply : RestfulService.Reply<GetInstallationToken.Response> = await this.client.fetch( new GetInstallationToken( installationId ) );
        if( !reply.ok ) return ResultUtils.err( `marketplace token resolution failed (${ reply.status })` );
        return ResultUtils.ok( reply.data as GetInstallationToken.Response );
    }

    /** Uninstall a marketplace installation (revoke + purge). */
    public async disconnect( installationId : Type.UUID ) : Promise<Type.Result<DeleteInstallation.Response>>
    {
        const reply : RestfulService.Reply<DeleteInstallation.Response> = await this.client.fetch( new DeleteInstallation( installationId ) );
        if( !reply.ok ) return ResultUtils.err( `marketplace disconnect failed (${ reply.status })` );
        return ResultUtils.ok( reply.data as DeleteInstallation.Response );
    }
}

export default MarketplaceClient;
