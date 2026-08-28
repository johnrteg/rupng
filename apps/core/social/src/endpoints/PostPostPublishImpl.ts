//
import { PostPostPublish, SocialPost } from "@repo/api";
import { NetworkUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";
import SocialService from "../services/SocialService";

//
// Publish a post now — validates + enqueues to the `social-publish` queue and returns immediately
// (CLAUDE.md: anything that can take >500ms is a job, never inline). The in-process queue drain (or,
// later, `SocialPublishWorker`) does the actual per-target publish.
//
export class PostPostPublishImpl extends PostPostPublish
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
        if( got.data.status === SocialPost.Status.PUBLISHED )
            return { status: NetworkUtils.Status.CONFLICT, data: { message: "post already published" } };
        if( got.data.approvalsRequired > 0 && got.data.status !== SocialPost.Status.APPROVED )
            return { status: NetworkUtils.Status.CONFLICT, data: { message: "post requires approval before publishing" } };

        const enqueued : Type.Result<void> = await this.service.sqs.send( "social-publish", { accountId, postId: id } );
        if( !enqueued.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "publish enqueue failed" } };

        return { status: NetworkUtils.Status.OK, data: got.data };
    }
}

export default PostPostPublishImpl;
