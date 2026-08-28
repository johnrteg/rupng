//
import { PatchPostComment, SocialPost } from "@repo/api";
import { NetworkUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";
import SocialService from "../services/SocialService";

//
// Resolve / unresolve a review comment.
//
export class PatchPostCommentImpl extends PatchPostComment
{
    private service : SocialService;
    constructor( service : SocialService ) { super(); this.service = service; }

    ////////////////////////////////////////////////////////////////////////////////////////////
    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        if( !auth.userId ) return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };
        const postId : string = this.query?.id ?? "";
        const commentId : string = this.query?.commentId ?? "";
        if( !postId || !commentId ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "id and commentId required" } };

        const got : Type.Result<SocialPost.ReviewComment | undefined> = await this.service.dynamo.get<SocialPost.ReviewComment>( "post_comments", { postId, id: commentId } );
        if( !got.ok )   return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "comment read failed" } };
        if( !got.data ) return { status: NetworkUtils.Status.NOT_FOUND, data: { message: "comment not found" } };

        const resolved : boolean = this.body?.resolved ?? false;
        const updated : SocialPost.ReviewComment = resolved
            ? { ...got.data, resolvedBy: auth.userId, resolvedAt: new Date().toISOString() }
            : { ...got.data, resolvedBy: undefined, resolvedAt: undefined };

        const wrote : Type.Result<void> = await this.service.dynamo.put( "post_comments", { ...updated } );
        if( !wrote.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "comment write failed" } };

        await this.service.appendAudit( postId, SocialPost.AuditAction.RESOLVE, auth.userId, `comment ${ commentId } ${ resolved ? "resolved" : "reopened" }` );

        return { status: NetworkUtils.Status.OK, data: updated };
    }
}

export default PatchPostCommentImpl;
