//
import { PostAssetCompress } from '@repo/api';
import { NetworkUtils } from '@repo/common';
import { RestfulEndpoint } from '@repo/endpoint';
import MediaService from '../services/MediaService';

// Compress a video to a distribution target (media-10.10) — enqueues the media-video Job.
export class PostAssetCompressImpl extends PostAssetCompress
{
    private service : MediaService;
    constructor( service : MediaService ) { super(); this.service = service; }

    ///////////////////////////////////////////////////////////////////////////////////////////
    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        if( !auth.userId )    return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };
        if( !auth.accountId ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "no acting account (X-Account)" } };
        const body : PostAssetCompress.Body | null = this.body;
        if( !this.query.guid || !body?.target ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "guid + target required" } };

        const outcome : { status : number } = await this.service.enqueueCompress( auth, this.query.guid, body.target );
        if( outcome.status === NetworkUtils.Status.ACCEPTED ) return { status: NetworkUtils.Status.ACCEPTED, data: { accepted: true } };

        const message : string =
            outcome.status === NetworkUtils.Status.NOT_FOUND ? "asset not found"
          : outcome.status === NetworkUtils.Status.CONFLICT  ? "only video assets can be compressed"
          : outcome.status === NetworkUtils.Status.BAD_REQUEST ? "unknown compression target"
          : "could not start compression";
        return { status: outcome.status, data: { message } };
    }
}

export default PostAssetCompressImpl;
