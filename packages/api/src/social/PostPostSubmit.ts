//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils, type Type } from "@repo/common";
import { SocialPost } from "./model/SocialPost";

//
// Submit a draft for review — DRAFT → PENDING_REVIEW, snapshotting the account's current
// `approvalsRequired` policy onto the post (immutable after — a later policy change doesn't retro-alter
// an in-flight post). A post with `approvalsRequired = 0` snapshots straight past review — callers
// should prefer `PostPostPublish` directly in that case, but submit still works (approves itself).
// SENDER-gated.
//
export class PostPostSubmit extends RestfulEndpoint< PostPostSubmit.Query, undefined, PostPostSubmit.Response >
{
    public readonly uri      : string = PostPostSubmit.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.POST;
    public readonly access   : Access.Role = Access.AccountRole.SENDER;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.PUBLIC;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "submitSocialPost",
        summary:     "Submit a post for review",
        description: "Moves a draft post into the review workflow.",
        tags:        [ "Social" ],
        errors:      { 404: "No such post in this account", 409: "Post isn't in draft" },
    };

    constructor( id? : string ) { super( { id: id ?? "" } ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return [ { field: "id", location: RestfulEndpoint.AttrLocation.URI, required: true } ]; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema():  RestfulEndpoint.Schema | null { return null; }
}

export namespace PostPostSubmit
{
    export const URI : string = apiPath( "social", 1, "/posts/:id/submit" );

    export interface Query { id : Type.UUID; }
    export interface Response extends SocialPost.Entity {}

    export enum Error
    {
        UNAUTHORIZED          = NetworkUtils.Status.UNAUTHORIZED,
        NOT_FOUND             = NetworkUtils.Status.NOT_FOUND,
        CONFLICT              = NetworkUtils.Status.CONFLICT,
        INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR,
    }
}

export default PostPostSubmit;
