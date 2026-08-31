//
import type { Message } from "@aws-sdk/client-sqs";
import { RequestContext, Sqs } from "@repo/services";
import type { Type } from "@repo/common";
import SocialService from "./SocialService";
import { SocialPipeline } from "../pipeline/SocialPipeline";

import GetConnectionsImpl from "../endpoints/GetConnectionsImpl";
import PostConnectionImpl from "../endpoints/PostConnectionImpl";
import DeleteConnectionImpl from "../endpoints/DeleteConnectionImpl";
import GetPostsImpl from "../endpoints/GetPostsImpl";
import PostPostImpl from "../endpoints/PostPostImpl";
import GetPostImpl from "../endpoints/GetPostImpl";
import DeletePostImpl from "../endpoints/DeletePostImpl";
import GetPostRenditionsImpl from "../endpoints/GetPostRenditionsImpl";
import PostPostPublishImpl from "../endpoints/PostPostPublishImpl";
import GetSocialConfigImpl from "../endpoints/GetSocialConfigImpl";
import PutSocialConfigImpl from "../endpoints/PutSocialConfigImpl";
import GetInboxImpl from "../endpoints/GetInboxImpl";
import PatchInboxItemImpl from "../endpoints/PatchInboxItemImpl";
import PostInboxRefreshImpl from "../endpoints/PostInboxRefreshImpl";
import PostPostSubmitImpl from "../endpoints/PostPostSubmitImpl";
import PostPostApprovalImpl from "../endpoints/PostPostApprovalImpl";
import GetPostCommentsImpl from "../endpoints/GetPostCommentsImpl";
import PostPostCommentImpl from "../endpoints/PostPostCommentImpl";
import PatchPostCommentImpl from "../endpoints/PatchPostCommentImpl";
import GetPostAuditImpl from "../endpoints/GetPostAuditImpl";
import PostSocialWebhookImpl from "../endpoints/PostSocialWebhookImpl";
import PostSocialDataDeletionImpl from "../endpoints/PostSocialDataDeletionImpl";

//
// MAIN role — the /social/* API (connections + posts CRUD, inbox, approval workflow, webhook intake +
// data-deletion callback) — which also drains the `social-publish` queue in-process for local/dev,
// mirroring media's queue-drain pattern. The real Lambda `SocialPublishWorker` (see jobs/) runs the
// exact same `SocialPipeline.publishPost` in a deploy.
//
// KNOWN GAP: `SocialInboundJob`/`SocialPollJob` have no MAIN in-process local-dev drain yet (unlike
// `social-publish`) — testing them locally means invoking the Lambda handler directly or wiring a
// drain loop later; not done here to avoid duplicating their (non-trivial) per-connection poll logic
// outside the job classes.
//
export class SocialMainService extends SocialService
{
    private stopping : boolean = false;

    ////////////////////////////////////////////////////////////////////////////////////////////
    constructor()
    {
        super( SocialService.Role.MAIN );
        void this.startPublishConsumer();
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // REPLACES the base's `formbody`-only registration (social has no form-urlencoded traffic — Meta's
    // webhook is JSON) — captures true raw bytes for `PostSocialWebhookImpl`'s `Webhook.hmacSha256RawBody`
    // check while still producing the same parsed `request.body` every other endpoint already expects.
    protected override addServerRegister() : void { this.enableRawBodyCapture(); }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** Register the social endpoint impls (after the inherited /health + /version). */
    protected override async registerEndpoints() : Promise<void>
    {
        await super.registerEndpoints();          // keeps /health + /version
        this.register( new GetConnectionsImpl( this ) );
        this.register( new PostConnectionImpl( this ) );
        this.register( new DeleteConnectionImpl( this ) );
        this.register( new GetPostsImpl( this ) );
        this.register( new PostPostImpl( this ) );
        this.register( new GetPostImpl( this ) );
        this.register( new DeletePostImpl( this ) );
        this.register( new GetPostRenditionsImpl( this ) );
        this.register( new PostPostPublishImpl( this ) );
        this.register( new GetSocialConfigImpl( this ) );
        this.register( new PutSocialConfigImpl( this ) );
        this.register( new GetInboxImpl( this ) );
        this.register( new PatchInboxItemImpl( this ) );
        this.register( new PostInboxRefreshImpl( this ) );
        this.register( new PostPostSubmitImpl( this ) );
        this.register( new PostPostApprovalImpl( this ) );
        this.register( new GetPostCommentsImpl( this ) );
        this.register( new PostPostCommentImpl( this ) );
        this.register( new PatchPostCommentImpl( this ) );
        this.register( new GetPostAuditImpl( this ) );
        this.register( new PostSocialWebhookImpl( this ) );
        this.register( new PostSocialDataDeletionImpl( this ) );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** Stop the publish-queue poll loop before the base closes the HTTP server. */
    protected override async aboutToQuit() : Promise<void>
    {
        this.stopping = true;
        await super.aboutToQuit();
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // SQS social-publish poll loop (dev drain of SocialPublishWorker). Each message re-enters the
    // RequestContext from its transaction-id attribute so per-target publish logs stay correlated.
    private async startPublishConsumer() : Promise<void>
    {
        this.log.info( "social publish consumer started (SQS social-publish)" );
        const deps : SocialPipeline.Deps = this.pipelineDeps();
        while( !this.stopping )
        {
            try
            {
                const received : Type.Result<Array<Message>> = await this.sqs.receive( "social-publish", 5, 10 );
                if( !received.ok ) { await this.delay( 5000 ); continue; }
                for( const message of received.data )
                    await RequestContext.run( { transactionId: Sqs.transactionId( message ) }, async () : Promise<void> =>
                    {
                        try
                        {
                            const body : { accountId? : string; postId? : string } = JSON.parse( message.Body ?? "{}" );
                            if( body.accountId && body.postId ) await SocialPipeline.publishPost( deps, body.accountId, body.postId );
                            if( message.ReceiptHandle ) await this.sqs.delete( "social-publish", message.ReceiptHandle );
                        }
                        catch( err ) { this.log.warn( "social publish failed (will redeliver)", { error: String( err ) } ); }
                    } );
            }
            catch( error ) { this.log.warn( "social publish receive failed — backing off", { error: String( error ) } ); await this.delay( 5000 ); }
        }
        this.log.info( "social publish consumer stopped" );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    private delay( ms : number ) : Promise<void> { return new Promise( ( resolve ) => setTimeout( resolve, ms ) ); }
}

export default SocialMainService;
