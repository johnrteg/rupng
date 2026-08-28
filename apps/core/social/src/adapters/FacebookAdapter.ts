//
import { SocialAccount, SocialInbound, SocialPost } from "@repo/api";
import { ResultUtils, type Type } from "@repo/common";
import { SocialAdapter } from "./SocialAdapter";
import { MetaWebhookUtils } from "./MetaWebhookUtils";

/** One `feed` change's value — just the fields `parseWebhook` reads. */
interface FeedChangeValue
{
    item?       : string;
    comment_id? : string;
    post_id?    : string;
    message?    : string;
    from?       : { id? : string; name? : string };
}

/** The shape of a Page `feed` webhook payload — just the fields `parseWebhook` reads. */
interface FeedWebhookPayload
{
    entry? : Array<{ id : string; time? : number; changes? : Array<{ value? : FeedChangeValue }> }>;
}

//
// FacebookAdapter — publishes to a Facebook Page via the Meta Graph API. Text/link posts go to
// `/feed`; a post carrying media goes to `/photos` (hosted-URL flow — media comes from `media`'s
// hosted URLs, never uploaded here). Verify the exact Graph API version + field names at build time
// (SPECS.md's repeated caveat — Meta's API surface shifts across versions).
//
export class FacebookAdapter implements SocialAdapter
{
    public readonly platform : SocialAccount.Platform = SocialAccount.Platform.FACEBOOK;

    private static readonly GRAPH_API : string = "https://graph.facebook.com/v21.0";
    private static readonly TEXT_LIMIT : number = 63206;   // Meta's Page-post character cap

    ////////////////////////////////////////////////////////////////////////////////////////////
    public capabilities() : SocialAdapter.Capabilities
    {
        return { webhooks: true, dms: false, twoStepMedia: false };   // Meta pushes via webhook; Messenger DMs are a later addition
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    public render( post : SocialPost.Entity, target : SocialPost.PostTarget ) : SocialPost.Rendition
    {
        return {
            platform:     target.platform,
            connectionId: target.connectionId,
            body:         post.body.slice( 0, FacebookAdapter.TEXT_LIMIT ),
            mediaKeys:    post.mediaKeys,
        };
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    public async publish( rendition : SocialPost.Rendition, accessToken : string ) : Promise<Type.Result<SocialAdapter.PublishResult>>
    {
        return ResultUtils.from( async () : Promise<SocialAdapter.PublishResult> =>
        {
            // a media-bearing post goes to /photos (hosted-URL "url" field); text/link goes to /feed
            const hasMedia : boolean = !!rendition.mediaKeys?.length;
            const endpoint : string = `${ FacebookAdapter.GRAPH_API }/${ rendition.connectionId }/${ hasMedia ? "photos" : "feed" }`;
            const body : Record<string, string> = hasMedia
                ? { url: rendition.mediaKeys![ 0 ], caption: rendition.body, access_token: accessToken }
                : { message: rendition.body, access_token: accessToken };

            const response : Response = await fetch( endpoint, {
                method:  "POST",
                headers: { "Content-Type": "application/x-www-form-urlencoded" },
                body:    new URLSearchParams( body ).toString(),
            } );
            if( !response.ok ) throw new Error( `Facebook publish failed (${ response.status })` );

            const data : { id? : string; post_id? : string } = await response.json();
            const platformPostId : string | undefined = data.post_id ?? data.id;
            if( !platformPostId ) throw new Error( "Facebook publish succeeded but returned no post id" );

            return { platformPostId };
        } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    public verifyWebhook( rawBody : string, headers : Record<string, string>, signingSecret : string ) : boolean
    {
        return MetaWebhookUtils.verifySignature( rawBody, headers, signingSecret );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** Parses a Page `feed` webhook — comments/mentions arrive as `entry[].changes[].value`, one item
     *  per change. Reactions/likes carry no message text and are skipped (nothing to show in the inbox). */
    public parseWebhook( payload : unknown ) : Array<SocialAdapter.RawInbound>
    {
        const body : FeedWebhookPayload = payload as FeedWebhookPayload;

        const items : Array<SocialAdapter.RawInbound> = [];
        for( const entry of body.entry ?? [] )
        {
            const occurredAt : string = entry.time ? new Date( entry.time * 1000 ).toISOString() : new Date().toISOString();
            for( const change of entry.changes ?? [] )
            {
                const value : FeedChangeValue | undefined = change.value;
                if( !value?.message ) continue;   // no text (e.g. a bare reaction) — nothing to surface
                items.push( {
                    type:         value.item === "comment" ? SocialInbound.Type_.COMMENT : SocialInbound.Type_.MENTION,
                    authorHandle: value.from?.name ?? value.from?.id ?? "unknown",
                    text:         value.message,
                    externalId:   value.comment_id ?? value.post_id ?? entry.id,
                    occurredAt,
                    sourceId:     entry.id,
                } );
            }
        }
        return items;
    }
}

export default FacebookAdapter;
