//
import { PostAssetTranscribe } from '@repo/api';
import { NetworkUtils } from '@repo/common';
import { RestfulEndpoint } from '@repo/endpoint';
import MediaService from '../services/MediaService';

// Transcribe an audio/video asset (media-18) — enqueues the media-transcribe Job (extract audio → Whisper).
// Async: returns 202; the Job saves asset.transcript + emits media.job stage events. 409 if not a/v.
export class PostAssetTranscribeImpl extends PostAssetTranscribe
{
    private service : MediaService;
    constructor( service : MediaService ) { super(); this.service = service; }

    ///////////////////////////////////////////////////////////////////////////////////////////
    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        this.service.log.trace( "execute: PostAssetTranscribeImpl", { userId: auth.userId, accountId: auth.accountId, guid: this.query?.guid } );
        if( !auth.userId )    return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };
        if( !auth.accountId ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "no acting account (X-Account)" } };
        if( !this.query.guid ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "guid required" } };

        const outcome : { status : number } = await this.service.enqueueTranscribe( auth, this.query.guid );
        if( outcome.status === NetworkUtils.Status.ACCEPTED ) return { status: NetworkUtils.Status.ACCEPTED, data: { accepted: true } };

        const message : string =
            outcome.status === NetworkUtils.Status.NOT_FOUND ? "asset not found"
          : outcome.status === NetworkUtils.Status.CONFLICT  ? "only audio/video assets can be transcribed"
          : "could not start transcription";
        return { status: outcome.status, data: { message } };
    }
}

export default PostAssetTranscribeImpl;
