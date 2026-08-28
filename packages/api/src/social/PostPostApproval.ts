//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils, type Type } from "@repo/common";
import { SocialPost } from "./model/SocialPost";

//
// Record an approve/reject decision on a post under review. N distinct approvers reaching
// `approvalsRequired` flips the post to APPROVED; a reject kicks it back to PENDING_REVIEW for
// edits/resubmission. USER-gated (above SENDER — reviewing is a step up from composing).
//
export class PostPostApproval extends RestfulEndpoint< PostPostApproval.Query, PostPostApproval.Body, PostPostApproval.Response >
{
    public readonly uri      : string = PostPostApproval.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.POST;
    public readonly access   : Access.Role = Access.AccountRole.USER;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.PUBLIC;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "recordSocialPostApproval",
        summary:     "Approve or reject a post",
        description: "Records an approve/reject decision on a post under review.",
        tags:        [ "Social" ],
        errors:      { 404: "No such post in this account", 409: "Post isn't pending review" },
    };

    constructor( id? : string, body? : PostPostApproval.Body ) { super( { id: id ?? "" }, body ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return [ { field: "id", location: RestfulEndpoint.AttrLocation.URI, required: true } ]; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null
    { return { type: "object", additionalProperties: false, required: [ "decision" ], properties: { decision: { type: "string", enum: Object.values( SocialPost.ApprovalDecision ) } } }; }
}

export namespace PostPostApproval
{
    export const URI : string = apiPath( "social", 1, "/posts/:id/approvals" );

    export interface Query { id : Type.UUID; }
    export interface Body extends RestfulEndpoint.AuthRequest { decision : SocialPost.ApprovalDecision; }
    export interface Response extends SocialPost.Entity {}

    export enum Error
    {
        BAD_REQUEST           = NetworkUtils.Status.BAD_REQUEST,
        UNAUTHORIZED          = NetworkUtils.Status.UNAUTHORIZED,
        NOT_FOUND             = NetworkUtils.Status.NOT_FOUND,
        CONFLICT              = NetworkUtils.Status.CONFLICT,
        INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR,
    }
}

export default PostPostApproval;
