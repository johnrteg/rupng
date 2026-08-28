//
import { PostAssetRescan, Media } from '@repo/api';
import { NetworkUtils, type Type } from '@repo/common';
import { RestfulEndpoint } from '@repo/endpoint';
import MediaService from '../services/MediaService';

//
// Re-probe an asset's content metadata (media-4) — the UI "rescan" action. Enqueues a metadata re-probe on
// the process queue (dev drains it in-process; a deploy runs MediaProcessJob), which re-reads the original
// bytes and refreshes image/video stats without touching variants. Async — returns the current asset; the
// client polls GET /assets/:guid. Only an asset whose bytes exist (past UPLOADING, not deleted) can be rescanned.
//
export class PostAssetRescanImpl extends PostAssetRescan
{
    private service : MediaService;
    constructor( service : MediaService ) { super(); this.service = service; }

    ///////////////////////////////////////////////////////////////////////////////////////////
    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        this.service.log.trace( "execute: PostAssetRescanImpl", { userId: auth.userId, accountId: auth.accountId, guid: this.query?.guid } );
        if( !auth.userId )   return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };
        const accountId : string | undefined = auth.accountId;
        if( !accountId )     return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "no acting account (X-Account)" } };
        const guid : string = this.query?.guid ?? "";
        if( !guid )          return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "guid required" } };

        const got : Type.Result<Media.Asset | undefined> = await this.service.dynamo.get<Media.Asset>( "media", { accountId, guid } );
        if( !got.ok )   return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "media read failed" } };
        if( !got.data ) return { status: NetworkUtils.Status.NOT_FOUND, data: { message: "media not found" } };

        const asset : Media.Asset = got.data;
        if( asset.status === Media.Status.DELETED )
            return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "asset is deleted" } };

        // Rescan = RE-RUN the full pipeline so renditions are regenerated from the original: real variant
        // bytes (fixing legacy/stub variants that were marked ready with no bytes) + a video poster + probed
        // metadata. An UPLOADING asset goes through scan first; anything else re-enters processing directly.
        const now : string = new Date().toISOString();
        if( asset.status === Media.Status.UPLOADING )
        {
            const advanced : Media.Asset = { ...asset, status: Media.Status.SCANNING, modifiedAt: now };
            const put = await this.service.dynamo.put( "media", { ...advanced } );
            if( !put.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "media write failed" } };
            await this.service.sqs.send( "media-scan", { accountId, guid } );
            this.service.log.trace( "message enqueued (SQS media-scan)", { accountId, guid } );
            void this.service.assetUpdated( advanced, auth.userId );   // media.asset updated (best-effort)
            return { status: NetworkUtils.Status.ACCEPTED, data: { asset: advanced } };
        }

        // re-enter processing (regenerates variant bytes + poster + metadata), then mark OK
        const reprocessing : Media.Asset = { ...asset, status: Media.Status.PROCESSING, modifiedAt: now };
        const put = await this.service.dynamo.put( "media", { ...reprocessing } );
        if( !put.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "media write failed" } };
        await this.service.sqs.send( "media-process", { accountId, guid } );
        this.service.log.trace( "message enqueued (SQS media-process)", { accountId, guid } );
        void this.service.assetUpdated( reprocessing, auth.userId );   // media.asset updated (best-effort)

        return { status: NetworkUtils.Status.ACCEPTED, data: { asset: reprocessing } };
    }
}

export default PostAssetRescanImpl;
