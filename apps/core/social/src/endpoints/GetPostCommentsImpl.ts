//
import { GetPostComments, SocialPost } from "@repo/api";
import { NetworkUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";
import SocialService from "../services/SocialService";

//
// List a post's review-thread comments, oldest first.
//
export class GetPostCommentsImpl extends GetPostComments
{
    private service : SocialService;
    constructor( service : SocialService ) { super(); this.service = service; }

    ////////////////////////////////////////////////////////////////////////////////////////////
    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        if( !auth.userId ) return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };
        const id : string = this.query?.id ?? "";
        if( !id )           return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "id required" } };

        const found : Type.Result<Array<SocialPost.ReviewComment>> = await this.service.dynamo.query<SocialPost.ReviewComment>( "post_comments", {
            KeyConditionExpression:    "postId = :p",
            ExpressionAttributeValues: { ":p": id },
        } );
        if( !found.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "comments read failed" } };

        const comments : Array<SocialPost.ReviewComment> = found.data
            .sort( ( first : SocialPost.ReviewComment, second : SocialPost.ReviewComment ) : number => first.at.localeCompare( second.at ) );

        return { status: NetworkUtils.Status.OK, data: { comments } };
    }
}

export default GetPostCommentsImpl;
