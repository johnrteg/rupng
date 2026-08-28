//
import { GetPost, SocialPost } from "@repo/api";
import { NetworkUtils, ObjectUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";
import SocialService from "../services/SocialService";

//
// Fetch a single post by id (tenant-scoped) plus its per-target `PublishedPost` results, if any.
//
export class GetPostImpl extends GetPost
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

        const published : Type.Result<Array<SocialPost.PublishedPost>> = await this.service.dynamo.query<SocialPost.PublishedPost>( "published_posts", {
            KeyConditionExpression:    "postId = :p",
            ExpressionAttributeValues: { ":p": id },
        } );

        return { status: NetworkUtils.Status.OK, data: {
            ...ObjectUtils.withDefaults( got.data, SocialPost.DEFAULT ),
            published: published.ok ? published.data : [],
        } };
    }
}

export default GetPostImpl;
