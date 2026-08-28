//
import { SocialAccount, SocialPost } from "@repo/api";
import { ResultUtils, type Type } from "@repo/common";
import { SocialAdapter } from "./SocialAdapter";

//
// LinkedInAdapter — the first Phase 1 adapter (simplest OAuth, no 2-step media container flow), used
// to prove the compose → adapter → publish pipeline end to end before the remaining four (Facebook /
// Instagram / X / TikTok) replicate this interface. Publishes an org-page text/link/image UGC post via
// the LinkedIn API (v2/ugcPosts). LinkedIn's API surface changes across access tiers — verify the
// exact request shape at build time (SPECS.md's repeated caveat).
//
export class LinkedInAdapter implements SocialAdapter
{
    public readonly platform : SocialAccount.Platform = SocialAccount.Platform.LINKEDIN;

    ////////////////////////////////////////////////////////////////////////////////////////////
    public capabilities() : SocialAdapter.Capabilities
    {
        return { webhooks: false, dms: false, twoStepMedia: false };   // LinkedIn is poll-only, no DM support here
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** LinkedIn's ~3000-char share-commentary limit is the only per-platform adaptation for text posts. */
    public render( post : SocialPost.Entity, target : SocialPost.PostTarget ) : SocialPost.Rendition
    {
        const LINKEDIN_MAX_CHARS : number = 3000;
        return {
            platform:     target.platform,
            connectionId: target.connectionId,
            body:         post.body.slice( 0, LINKEDIN_MAX_CHARS ),
            mediaKeys:    post.mediaKeys,
        };
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    public async publish( rendition : SocialPost.Rendition, accessToken : string ) : Promise<Type.Result<SocialAdapter.PublishResult>>
    {
        return ResultUtils.from( async () : Promise<SocialAdapter.PublishResult> =>
        {
            // the connected account's `connectionId` stands in for the LinkedIn organization urn until
            // ConnectedAccount carries the real platform-native id (a Milestone 4 follow-on)
            const response : Response = await fetch( "https://api.linkedin.com/v2/ugcPosts", {
                method:  "POST",
                headers: {
                    "Authorization":       `Bearer ${ accessToken }`,
                    "Content-Type":        "application/json",
                    "X-Restli-Protocol-Version": "2.0.0",
                },
                body: JSON.stringify( {
                    author:          `urn:li:organization:${ rendition.connectionId }`,
                    lifecycleState:  "PUBLISHED",
                    specificContent: {
                        "com.linkedin.ugc.ShareContent": {
                            shareCommentary:    { text: rendition.body },
                            shareMediaCategory: rendition.mediaKeys?.length ? "IMAGE" : "NONE",
                        },
                    },
                    visibility: { "com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC" },
                } ),
            } );

            if( !response.ok ) throw new Error( `LinkedIn publish failed (${ response.status })` );

            const platformPostId : string = response.headers.get( "x-restli-id" ) ?? "";
            if( !platformPostId ) throw new Error( "LinkedIn publish succeeded but returned no post id" );

            return { platformPostId };
        } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** LinkedIn's comment/mention read API needs Marketing Developer Platform partnership access
     *  most integrations don't have (SPECS.md's delivery-by-provider table: "heavy app review; limited
     *  comment access"). Returns an empty result rather than a fabricated endpoint call until that
     *  access is in place — `SocialPollJob` treats an empty poll as "nothing new", not an error. */
    public async pollInbound( _connectionId : string, _accessToken : string, _sinceISO : string ) : Promise<Type.Result<Array<SocialAdapter.RawInbound>>>
    {
        return ResultUtils.ok( [] );
    }
}

export default LinkedInAdapter;
