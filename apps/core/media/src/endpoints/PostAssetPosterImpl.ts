//
import { PostAssetPoster, Media } from '@repo/api';
import { NetworkUtils, type Type } from '@repo/common';
import { RestfulEndpoint } from '@repo/endpoint';
import MediaService from '../services/MediaService';

//
// Regenerate a video's poster from a chosen frame (media-4). Validates it's a servable VIDEO, then enqueues
// the poster extraction (dev drains the queue in-process; a deploy runs MediaProcessJob). Async — returns the
// current asset; the client polls GET /assets/:guid until the poster variant refreshes.
//
export class PostAssetPosterImpl extends PostAssetPoster
{
    private service : MediaService;
    constructor( service : MediaService ) { super(); this.service = service; }

    ///////////////////////////////////////////////////////////////////////////////////////////
    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        this.service.log.trace( "execute: PostAssetPosterImpl", { userId: auth.userId, accountId: auth.accountId, guid: this.query?.guid } );
        if( !auth.userId )   return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };
        const accountId : string | undefined = auth.accountId;
        if( !accountId )     return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "no acting account (X-Account)" } };
        const guid : string = this.query?.guid ?? "";
        if( !guid )          return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "guid required" } };
        const atSeconds : number = this.body?.atSeconds ?? 0;

        const got : Type.Result<Media.Asset | undefined> = await this.service.dynamo.get<Media.Asset>( "media", { accountId, guid } );
        if( !got.ok )   return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "media read failed" } };
        if( !got.data ) return { status: NetworkUtils.Status.NOT_FOUND, data: { message: "media not found" } };

        const asset : Media.Asset = got.data;
        if( asset.kind !== Media.Kind.VIDEO )
            return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "poster frames apply to video only" } };
        if( asset.status !== Media.Status.OK )
            return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "video is not ready" } };

        await this.service.sqs.send( "media-process", { accountId, guid, posterAt: Math.max( 0, atSeconds ) } );
        this.service.log.trace( "message enqueued (SQS media-process)", { accountId, guid } );
        void this.service.assetUpdated( asset, auth.userId );   // media.asset updated (best-effort)

        return { status: NetworkUtils.Status.ACCEPTED, data: { asset } };
    }
}

export default PostAssetPosterImpl;
