//
import { PostUploadComplete, Media } from '@repo/api';
import { NetworkUtils, type Type } from '@repo/common';
import { RestfulEndpoint } from '@repo/endpoint';
import MediaService from '../services/MediaService';

//
// The client finished the direct-to-S3 PUT. Advance UPLOADING → SCANNING and enqueue the scan stage (which,
// on clean, enqueues processing). Idempotent: a non-UPLOADING asset is returned unchanged.
//
export class PostUploadCompleteImpl extends PostUploadComplete
{
    private service : MediaService;
    constructor( service : MediaService ) { super(); this.service = service; }

    ///////////////////////////////////////////////////////////////////////////////////////////
    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        this.service.log.trace( "execute: PostUploadCompleteImpl", { userId: auth.userId, accountId: auth.accountId, guid: this.query?.guid } );
        if( !auth.userId )   return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };
        const accountId : string | undefined = auth.accountId;
        if( !accountId )     return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "no acting account (X-Account)" } };
        const guid : string = this.query?.guid ?? "";
        if( !guid )          return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "guid required" } };

        const got : Type.Result<Media.Asset | undefined> = await this.service.dynamo.get<Media.Asset>( "media", { accountId, guid } );
        if( !got.ok )   return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "media read failed" } };
        if( !got.data ) return { status: NetworkUtils.Status.NOT_FOUND, data: { message: "media not found" } };

        if( got.data.status !== Media.Status.UPLOADING )
            return { status: NetworkUtils.Status.OK, data: { asset: got.data } };   // already advanced — idempotent

        const asset : Media.Asset = { ...got.data, status: Media.Status.SCANNING, modifiedAt: new Date().toISOString() };
        const put = await this.service.dynamo.put( "media", { ...asset } );
        if( !put.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "media write failed" } };

        await this.service.sqs.send( "media-scan", { accountId, guid } );   // → scan → process pipeline
        this.service.log.trace( "message enqueued (SQS media-scan)", { accountId, guid } );
        void this.service.assetCreated( asset, auth.userId );               // media.asset created (best-effort)

        return { status: NetworkUtils.Status.OK, data: { asset } };
    }
}

export default PostUploadCompleteImpl;
