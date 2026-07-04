//
import { PostAssetArchive } from '@repo/api';
import { NetworkUtils } from '@repo/common';
import { RestfulEndpoint } from '@repo/endpoint';
import MediaService from '../services/MediaService';

// Request a download archive (media-20) — enqueues the media-archive Job; returns the archiveId to track.
export class PostAssetArchiveImpl extends PostAssetArchive
{
    private service : MediaService;
    constructor( service : MediaService ) { super(); this.service = service; }

    ///////////////////////////////////////////////////////////////////////////////////////////
    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        if( !auth.userId )    return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };
        if( !auth.accountId ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "no acting account (X-Account)" } };
        if( !this.query.guid ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "guid required" } };

        const outcome : { status : number; archiveId? : string } = await this.service.enqueueArchive( auth, this.query.guid );
        if( outcome.status === NetworkUtils.Status.ACCEPTED && outcome.archiveId )
            return { status: NetworkUtils.Status.ACCEPTED, data: { archiveId: outcome.archiveId } };
        const message : string = outcome.status === NetworkUtils.Status.NOT_FOUND ? "asset not found" : "could not start the archive";
        return { status: outcome.status, data: { message } };
    }
}

export default PostAssetArchiveImpl;
