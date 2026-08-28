//
import { randomUUID } from "node:crypto";

import { PostPostComment, SocialPost } from "@repo/api";
import { NetworkUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";
import SocialService from "../services/SocialService";

//
// Add a comment to a post's review thread.
//
export class PostPostCommentImpl extends PostPostComment
{
    private service : SocialService;
    constructor( service : SocialService ) { super(); this.service = service; }

    ////////////////////////////////////////////////////////////////////////////////////////////
    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        if( !auth.userId ) return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };
        const postId : string = this.query?.id ?? "";
        if( !postId )       return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "id required" } };
        const text : string | undefined = this.body?.text;
        if( !text )         return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "text required" } };

        const comment : SocialPost.ReviewComment = { id: randomUUID(), postId, by: auth.userId, at: new Date().toISOString(), text };
        const wrote : Type.Result<void> = await this.service.dynamo.put( "post_comments", { ...comment } );
        if( !wrote.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "comment write failed" } };

        await this.service.appendAudit( postId, SocialPost.AuditAction.COMMENT, auth.userId, text );

        return { status: NetworkUtils.Status.OK, data: comment };
    }
}

export default PostPostCommentImpl;
