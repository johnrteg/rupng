//
import { PostAssetExtractAudio } from '@repo/api';
import { NetworkUtils } from '@repo/common';
import { RestfulEndpoint } from '@repo/endpoint';
import MediaService from '../services/MediaService';

// Extract a video's audio track into an `audio` variant — enqueues the extract job (shares the media-transcribe
// queue). Async: returns 202; the Job adds the AUDIO item + emits extract-audio stage events. 409 if not a video.
export class PostAssetExtractAudioImpl extends PostAssetExtractAudio
{
    private service : MediaService;
    constructor( service : MediaService ) { super(); this.service = service; }

    ///////////////////////////////////////////////////////////////////////////////////////////
    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        this.service.log.trace( "execute: PostAssetExtractAudioImpl", { userId: auth.userId, accountId: auth.accountId, guid: this.query?.guid } );
        if( !auth.userId )    return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };
        if( !auth.accountId ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "no acting account (X-Account)" } };
        if( !this.query.guid ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "guid required" } };

        const outcome : { status : number } = await this.service.enqueueExtractAudio( auth, this.query.guid );
        if( outcome.status === NetworkUtils.Status.ACCEPTED ) return { status: NetworkUtils.Status.ACCEPTED, data: { accepted: true } };

        const message : string =
            outcome.status === NetworkUtils.Status.NOT_FOUND ? "asset not found"
          : outcome.status === NetworkUtils.Status.CONFLICT  ? "only video assets have a separable audio track"
          : "could not start audio extraction";
        return { status: outcome.status, data: { message } };
    }
}

export default PostAssetExtractAudioImpl;
