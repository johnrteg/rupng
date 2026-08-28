//
import { PostAssetBurnCaptions } from '@repo/api';
import { NetworkUtils } from '@repo/common';
import { RestfulEndpoint } from '@repo/endpoint';
import MediaService from '../services/MediaService';

// Burn a video asset's transcript captions onto the video (media-2x) — enqueues the media-caption-burn Job
// (ffmpeg drawtext overlay, reusing Studio's render compositor). Async: returns 202; the Job saves a new
// `Usage.CAPTIONED` item on the SAME asset + emits media.job stage events. 409 if not a video / not a caption item.
export class PostAssetBurnCaptionsImpl extends PostAssetBurnCaptions
{
    private service : MediaService;
    constructor( service : MediaService ) { super(); this.service = service; }

    ///////////////////////////////////////////////////////////////////////////////////////////
    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        this.service.log.trace( "execute: PostAssetBurnCaptionsImpl", { userId: auth.userId, accountId: auth.accountId, guid: this.query?.guid } );
        if( !auth.userId )    return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };
        if( !auth.accountId ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "no acting account (X-Account)" } };
        if( !this.query.guid ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "guid required" } };
        const transcriptItem : string = this.body?.transcriptItem ?? "";
        if( !transcriptItem ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "transcriptItem required" } };

        const outcome : { status : number } = await this.service.enqueueBurnCaptions( auth, this.query.guid, transcriptItem, this.body?.style, this.body?.position, this.body?.fontPct );
        if( outcome.status === NetworkUtils.Status.ACCEPTED ) return { status: NetworkUtils.Status.ACCEPTED, data: { accepted: true } };

        const message : string =
            outcome.status === NetworkUtils.Status.NOT_FOUND ? "asset not found"
          : outcome.status === NetworkUtils.Status.CONFLICT  ? "only a video's .srt/.vtt transcript can be burned in"
          : "could not start the caption burn";
        return { status: outcome.status, data: { message } };
    }
}

export default PostAssetBurnCaptionsImpl;
