//
import { SocialAccount, SocialInbound, SocialPost } from "@repo/api";
import { ResultUtils, type Type } from "@repo/common";
import { SocialAdapter } from "./SocialAdapter";

//
// XAdapter — publishes a tweet via X API v2. Threads and media attachment (media_ids, which need a
// separate upload endpoint) aren't wired yet — text-only for this initial cut. X's tiered API access
// changes access/pricing often; verify at build time (SPECS.md's repeated caveat, esp. for X).
//
export class XAdapter implements SocialAdapter
{
    public readonly platform : SocialAccount.Platform = SocialAccount.Platform.X;

    private static readonly TEXT_LIMIT : number = 280;

    ////////////////////////////////////////////////////////////////////////////////////////////
    public capabilities() : SocialAdapter.Capabilities
    {
        return { webhooks: false, dms: false, twoStepMedia: false };   // poll-only; DMs are heavily access-tier-limited
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    public render( post : SocialPost.Entity, target : SocialPost.PostTarget ) : SocialPost.Rendition
    {
        return {
            platform:     target.platform,
            connectionId: target.connectionId,
            body:         post.body.slice( 0, XAdapter.TEXT_LIMIT ),
            mediaKeys:    post.mediaKeys,
        };
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    public async publish( rendition : SocialPost.Rendition, accessToken : string ) : Promise<Type.Result<SocialAdapter.PublishResult>>
    {
        return ResultUtils.from( async () : Promise<SocialAdapter.PublishResult> =>
        {
            const response : Response = await fetch( "https://api.twitter.com/2/tweets", {
                method:  "POST",
                headers: { "Authorization": `Bearer ${ accessToken }`, "Content-Type": "application/json" },
                body:    JSON.stringify( { text: rendition.body } ),
            } );
            if( !response.ok ) throw new Error( `X publish failed (${ response.status })` );

            const data : { data? : { id? : string } } = await response.json();
            const platformPostId : string | undefined = data.data?.id;
            if( !platformPostId ) throw new Error( "X publish succeeded but returned no tweet id" );

            return { platformPostId };
        } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** Pulls the connected account's recent mentions (X's `/users/:id/mentions`, `connectionId` stands
     *  in for the numeric X user id — same simplification `publish` makes for the org/page id). Comment
     *  ingestion on the account's OWN tweets would need a separate search-by-conversation-id call per
     *  published tweet; deferred until `PublishedPost.platformPostId` tracking feeds it in. */
    public async pollInbound( connectionId : string, accessToken : string, sinceISO : string ) : Promise<Type.Result<Array<SocialAdapter.RawInbound>>>
    {
        return ResultUtils.from( async () : Promise<Array<SocialAdapter.RawInbound>> =>
        {
            const url : string = `https://api.twitter.com/2/users/${ connectionId }/mentions?start_time=${ encodeURIComponent( sinceISO ) }&tweet.fields=created_at,author_id`;
            const response : Response = await fetch( url, { headers: { "Authorization": `Bearer ${ accessToken }` } } );
            if( !response.ok ) throw new Error( `X mentions poll failed (${ response.status })` );

            const data : { data? : Array<{ id : string; text : string; author_id? : string; created_at? : string }> } = await response.json();
            return ( data.data ?? [] ).map( ( tweet ) : SocialAdapter.RawInbound => ( {
                type:         SocialInbound.Type_.MENTION,
                authorHandle: tweet.author_id ?? "unknown",
                text:         tweet.text,
                externalId:   tweet.id,
                occurredAt:   tweet.created_at ?? new Date().toISOString(),
            } ) );
        } );
    }
}

export default XAdapter;
