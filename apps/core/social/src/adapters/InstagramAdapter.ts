//
import { SocialAccount, SocialInbound, SocialPost } from "@repo/api";
import { ResultUtils, type Type } from "@repo/common";
import { SocialAdapter } from "./SocialAdapter";
import { MetaWebhookUtils } from "./MetaWebhookUtils";

/** One `comments`/`mentions` field change's value — just what `parseWebhook` reads. */
interface InstagramChangeValue
{
    id?   : string;
    text? : string;
    from? : { id? : string; username? : string };
}

/** The shape of an Instagram webhook payload — just the fields `parseWebhook` reads. */
interface InstagramWebhookPayload
{
    entry? : Array<{ id : string; time? : number; changes? : Array<{ field? : string; value? : InstagramChangeValue }> }>;
}

//
// InstagramAdapter — publishes to an Instagram Business/Creator account via the Meta Graph API's
// container→publish 2-step flow: create a media container from a HOSTED media URL, then publish that
// container. Instagram has no text-only post type — a rendition without media fails fast. Verify the
// exact Graph API version + field names at build time (SPECS.md's repeated caveat).
//
export class InstagramAdapter implements SocialAdapter
{
    public readonly platform : SocialAccount.Platform = SocialAccount.Platform.INSTAGRAM;

    private static readonly GRAPH_API : string = "https://graph.facebook.com/v21.0";
    private static readonly CAPTION_LIMIT : number = 2200;

    ////////////////////////////////////////////////////////////////////////////////////////////
    public capabilities() : SocialAdapter.Capabilities
    {
        return { webhooks: true, dms: false, twoStepMedia: true };   // Meta pushes via webhook; IG messaging is a later addition
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    public render( post : SocialPost.Entity, target : SocialPost.PostTarget ) : SocialPost.Rendition
    {
        return {
            platform:     target.platform,
            connectionId: target.connectionId,
            body:         post.body.slice( 0, InstagramAdapter.CAPTION_LIMIT ),
            mediaKeys:    post.mediaKeys,
        };
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    public async publish( rendition : SocialPost.Rendition, accessToken : string ) : Promise<Type.Result<SocialAdapter.PublishResult>>
    {
        if( !rendition.mediaKeys?.length ) return ResultUtils.err( "Instagram requires at least one media item — text-only posts aren't supported" );

        return ResultUtils.from( async () : Promise<SocialAdapter.PublishResult> =>
        {
            // step 1: create the media container from a hosted image URL
            const containerResponse : Response = await fetch( `${ InstagramAdapter.GRAPH_API }/${ rendition.connectionId }/media`, {
                method:  "POST",
                headers: { "Content-Type": "application/x-www-form-urlencoded" },
                body:    new URLSearchParams( { image_url: rendition.mediaKeys![ 0 ], caption: rendition.body, access_token: accessToken } ).toString(),
            } );
            if( !containerResponse.ok ) throw new Error( `Instagram container creation failed (${ containerResponse.status })` );
            const container : { id? : string } = await containerResponse.json();
            if( !container.id ) throw new Error( "Instagram container creation succeeded but returned no container id" );

            // step 2: publish the container
            const publishResponse : Response = await fetch( `${ InstagramAdapter.GRAPH_API }/${ rendition.connectionId }/media_publish`, {
                method:  "POST",
                headers: { "Content-Type": "application/x-www-form-urlencoded" },
                body:    new URLSearchParams( { creation_id: container.id, access_token: accessToken } ).toString(),
            } );
            if( !publishResponse.ok ) throw new Error( `Instagram publish failed (${ publishResponse.status })` );
            const published : { id? : string } = await publishResponse.json();
            if( !published.id ) throw new Error( "Instagram publish succeeded but returned no post id" );

            return { platformPostId: published.id };
        } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    public verifyWebhook( rawBody : string, headers : Record<string, string>, signingSecret : string ) : boolean
    {
        return MetaWebhookUtils.verifySignature( rawBody, headers, signingSecret );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** Parses a `comments`/`mentions` webhook — one item per change; a change with no `text` (e.g. a
     *  bare like) is skipped. */
    public parseWebhook( payload : unknown ) : Array<SocialAdapter.RawInbound>
    {
        const body : InstagramWebhookPayload = payload as InstagramWebhookPayload;

        const items : Array<SocialAdapter.RawInbound> = [];
        for( const entry of body.entry ?? [] )
        {
            const occurredAt : string = entry.time ? new Date( entry.time * 1000 ).toISOString() : new Date().toISOString();
            for( const change of entry.changes ?? [] )
            {
                const value : InstagramChangeValue | undefined = change.value;
                if( !value?.text ) continue;
                items.push( {
                    type:         change.field === "mentions" ? SocialInbound.Type_.MENTION : SocialInbound.Type_.COMMENT,
                    authorHandle: value.from?.username ?? value.from?.id ?? "unknown",
                    text:         value.text,
                    externalId:   value.id ?? entry.id,
                    occurredAt,
                    sourceId:     entry.id,
                } );
            }
        }
        return items;
    }
}

export default InstagramAdapter;
