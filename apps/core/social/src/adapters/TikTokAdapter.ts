//
import { SocialAccount, SocialPost } from "@repo/api";
import { ResultUtils, type Type } from "@repo/common";
import { SocialAdapter } from "./SocialAdapter";

//
// TikTokAdapter — publishes a video via the Content Posting API's "direct post" flow, sourcing the
// video from a hosted URL (`PULL_FROM_URL`) rather than a chunked upload. TikTok is video-first — a
// rendition without media fails fast. The API returns a `publish_id` immediately but publishing
// itself is ASYNC (TikTok processes the video before it's live) — this adapter treats `publish_id` as
// the platform post id for now; polling `/v2/post/publish/status/fetch/` for the real outcome is a
// follow-up (SocialPollJob territory). Heavy app-review gate + strict video specs — verify at build
// time (SPECS.md's repeated caveat).
//
export class TikTokAdapter implements SocialAdapter
{
    public readonly platform : SocialAccount.Platform = SocialAccount.Platform.TIKTOK;

    private static readonly CAPTION_LIMIT : number = 2200;

    ////////////////////////////////////////////////////////////////////////////////////////////
    public capabilities() : SocialAdapter.Capabilities
    {
        return { webhooks: false, dms: false, twoStepMedia: false };   // poll-only; no general business DM API
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    public render( post : SocialPost.Entity, target : SocialPost.PostTarget ) : SocialPost.Rendition
    {
        return {
            platform:     target.platform,
            connectionId: target.connectionId,
            body:         post.body.slice( 0, TikTokAdapter.CAPTION_LIMIT ),
            mediaKeys:    post.mediaKeys,
        };
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    public async publish( rendition : SocialPost.Rendition, accessToken : string ) : Promise<Type.Result<SocialAdapter.PublishResult>>
    {
        if( !rendition.mediaKeys?.length ) return ResultUtils.err( "TikTok requires a video — text-only posts aren't supported" );

        return ResultUtils.from( async () : Promise<SocialAdapter.PublishResult> =>
        {
            const response : Response = await fetch( "https://open.tiktokapis.com/v2/post/publish/video/init/", {
                method:  "POST",
                headers: { "Authorization": `Bearer ${ accessToken }`, "Content-Type": "application/json" },
                body:    JSON.stringify( {
                    post_info:   { caption: rendition.body },
                    source_info: { source: "PULL_FROM_URL", video_url: rendition.mediaKeys![ 0 ] },
                } ),
            } );
            if( !response.ok ) throw new Error( `TikTok publish failed (${ response.status })` );

            const data : { data? : { publish_id? : string } } = await response.json();
            const platformPostId : string | undefined = data.data?.publish_id;
            if( !platformPostId ) throw new Error( "TikTok publish succeeded but returned no publish id" );

            return { platformPostId };
        } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** TikTok's comment-read API is heavily access-restricted (SPECS.md's delivery-by-provider table:
     *  "comment API access restricted"). Returns an empty result rather than a fabricated endpoint
     *  call until that access is granted — `SocialPollJob` treats an empty poll as "nothing new". */
    public async pollInbound( _connectionId : string, _accessToken : string, _sinceISO : string ) : Promise<Type.Result<Array<SocialAdapter.RawInbound>>>
    {
        return ResultUtils.ok( [] );
    }
}

export default TikTokAdapter;
