//
import { GetPostRenditions, SocialPost } from "@repo/api";
import { NetworkUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";
import SocialService from "../services/SocialService";
import { AdapterFactory } from "../adapters/AdapterFactory";

//
// Preview each target's rendition without publishing. A target on a platform with no adapter yet
// (Facebook/Instagram/X/TikTok — Milestone 4) falls back to the raw post body, unmodified.
//
export class GetPostRenditionsImpl extends GetPostRenditions
{
    private service : SocialService;
    constructor( service : SocialService ) { super(); this.service = service; }

    ////////////////////////////////////////////////////////////////////////////////////////////
    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        if( !auth.userId )   return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };
        const accountId : string | undefined = auth.accountId;
        if( !accountId )     return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "no acting account (X-Account)" } };
        const id : string = this.query?.id ?? "";
        if( !id )            return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "id required" } };

        const got : Type.Result<SocialPost.Entity | undefined> = await this.service.dynamo.get<SocialPost.Entity>( "posts", { accountId, id } );
        if( !got.ok )   return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "post read failed" } };
        if( !got.data ) return { status: NetworkUtils.Status.NOT_FOUND, data: { message: "post not found" } };

        const post : SocialPost.Entity = got.data;
        const renditions : Array<SocialPost.Rendition> = post.targets.map( ( target : SocialPost.PostTarget ) : SocialPost.Rendition =>
        {
            const adapter = AdapterFactory.for( target.platform );
            return adapter ? adapter.render( post, target ) : { platform: target.platform, connectionId: target.connectionId, body: post.body, mediaKeys: post.mediaKeys };
        } );

        return { status: NetworkUtils.Status.OK, data: { renditions } };
    }
}

export default GetPostRenditionsImpl;
