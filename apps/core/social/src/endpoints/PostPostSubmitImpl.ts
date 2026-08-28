//
import { PostPostSubmit, SocialPost, SocialConfig } from "@repo/api";
import { NetworkUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";
import { Events } from "@repo/services";
import SocialService from "../services/SocialService";

//
// Submit a draft for review — DRAFT → PENDING_REVIEW (or straight to APPROVED when the account's
// current policy requires zero approvals), snapshotting `approvalsRequired` immutably onto the post.
//
export class PostPostSubmitImpl extends PostPostSubmit
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
        if( got.data.status !== SocialPost.Status.DRAFT )
            return { status: NetworkUtils.Status.CONFLICT, data: { message: "post isn't in draft" } };

        const config : SocialConfig.Config = await this.service.socialConfig();
        const approvalsRequired : number = config.approvals.requiredDefault;
        const now : Type.ISODateTime = new Date().toISOString();
        const submitted : SocialPost.Entity = {
            ...got.data,
            approvalsRequired,
            approvals:  [],
            status:     approvalsRequired > 0 ? SocialPost.Status.PENDING_REVIEW : SocialPost.Status.APPROVED,
            modifiedAt: now,
        };

        const wrote : Type.Result<void> = await this.service.dynamo.put( "posts", { ...submitted } );
        if( !wrote.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "post submit failed" } };

        await this.service.appendAudit( id, SocialPost.AuditAction.SUBMIT, auth.userId );
        await this.service.emitPostEvent( Events.Verb.UPDATED, submitted );

        return { status: NetworkUtils.Status.OK, data: submitted };
    }
}

export default PostPostSubmitImpl;
