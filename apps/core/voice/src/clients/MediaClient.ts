//
import { NetworkUtils, ResultUtils, type Type } from "@repo/common";
import { RestfulService } from "@repo/endpoint";
import { Ports } from "@repo/services";
import { PostInternalAsset } from "@repo/api";

//
// MediaClient — the S2S client to media's internal asset-storage API. Base URL is `MEDIA_INTERNAL_URL` (the
// internal ALB DNS in deployed envs, wired by the CloudManifest `uses` entry), falling back to media's
// local-dev port for `tsx watch`/LocalStack — same pattern as social's `MarketplaceClient`
// (apps/core/social/src/clients/MarketplaceClient.ts).
//
export class MediaClient
{
    private readonly client : RestfulService;

    ////////////////////////////////////////////////////////////////////////////////////////////
    constructor()
    {
        this.client = new RestfulService(
            process.env.MEDIA_INTERNAL_URL ?? NetworkUtils.url( NetworkUtils.Protocol.HTTP, "localhost", Ports.MEDIA.MAIN, null, null ) );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** Store raw bytes as a new media asset (S2S) — returns the created asset + a presigned playback URL. */
    public async storeAsset( body : PostInternalAsset.Body ) : Promise<Type.Result<PostInternalAsset.Response>>
    {
        const reply : RestfulService.Reply<PostInternalAsset.Response> = await this.client.fetch( new PostInternalAsset( body ) );
        if( !reply.ok ) return ResultUtils.err( `media store-asset failed (${ reply.status })` );
        return ResultUtils.ok( reply.data as PostInternalAsset.Response );
    }
}

export default MediaClient;
// eof
