//
import { PostPostApproval, SocialPost } from "@repo/api";
import { NetworkUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";
import { Events } from "@repo/services";
import SocialService from "../services/SocialService";

//
// Record an approve/reject decision. N distinct APPROVE decisions reaching `approvalsRequired` flips
// the post to APPROVED; a REJECT kicks it back to PENDING_REVIEW (for edits/resubmission — never a
// terminal state, since the post might just need a tweak).
//
export class PostPostApprovalImpl extends PostPostApproval
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
        const decision : SocialPost.ApprovalDecision | undefined = this.body?.decision;
        if( !decision )      return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "decision required" } };

        const got : Type.Result<SocialPost.Entity | undefined> = await this.service.dynamo.get<SocialPost.Entity>( "posts", { accountId, id } );
        if( !got.ok )   return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "post read failed" } };
        if( !got.data ) return { status: NetworkUtils.Status.NOT_FOUND, data: { message: "post not found" } };
        if( got.data.status !== SocialPost.Status.PENDING_REVIEW )
            return { status: NetworkUtils.Status.CONFLICT, data: { message: "post isn't pending review" } };

        const now : Type.ISODateTime = new Date().toISOString();
        const approvals : Array<SocialPost.Approval> = [ ...( got.data.approvals ?? [] ), { by: auth.userId, at: now, decision } ];
        const approveCount : number = approvals.filter( ( entry : SocialPost.Approval ) : boolean => entry.decision === SocialPost.ApprovalDecision.APPROVE ).length;

        const updated : SocialPost.Entity = {
            ...got.data,
            approvals,
            status:     decision === SocialPost.ApprovalDecision.APPROVE && approveCount >= got.data.approvalsRequired
                ? SocialPost.Status.APPROVED
                : SocialPost.Status.PENDING_REVIEW,
            modifiedAt: now,
        };

        const wrote : Type.Result<void> = await this.service.dynamo.put( "posts", { ...updated } );
        if( !wrote.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "approval write failed" } };

        await this.service.appendAudit( id, decision === SocialPost.ApprovalDecision.APPROVE ? SocialPost.AuditAction.APPROVE : SocialPost.AuditAction.REJECT, auth.userId );
        await this.service.emitPostEvent( Events.Verb.UPDATED, updated );

        return { status: NetworkUtils.Status.OK, data: updated };
    }
}

export default PostPostApprovalImpl;
