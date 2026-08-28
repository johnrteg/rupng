//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils, type Type } from "@repo/common";
import { SocialPost } from "./model/SocialPost";

//
// Resolve / unresolve a review comment. SENDER-gated.
//
export class PatchPostComment extends RestfulEndpoint< PatchPostComment.Query, PatchPostComment.Body, PatchPostComment.Response >
{
    public readonly uri      : string = PatchPostComment.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.PATCH;
    public readonly access   : Access.Role = Access.AccountRole.SENDER;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.PUBLIC;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "updateSocialPostComment",
        summary:     "Resolve or unresolve a review comment",
        description: "Sets or clears a review comment's resolved state.",
        tags:        [ "Social" ],
        errors:      { 404: "No such post or comment in this account" },
    };

    constructor( id? : string, commentId? : string, body? : PatchPostComment.Body ) { super( { id: id ?? "", commentId: commentId ?? "" }, body ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return [
        { field: "id",        location: RestfulEndpoint.AttrLocation.URI, required: true },
        { field: "commentId", location: RestfulEndpoint.AttrLocation.URI, required: true },
    ]; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null
    { return { type: "object", additionalProperties: false, required: [ "resolved" ], properties: { resolved: { type: "boolean" } } }; }
}

export namespace PatchPostComment
{
    export const URI : string = apiPath( "social", 1, "/posts/:id/comments/:commentId" );

    export interface Query { id : Type.UUID; commentId : Type.UUID; }
    export interface Body extends RestfulEndpoint.AuthRequest { resolved : boolean; }
    export interface Response extends SocialPost.ReviewComment {}

    export enum Error
    {
        BAD_REQUEST           = NetworkUtils.Status.BAD_REQUEST,
        UNAUTHORIZED          = NetworkUtils.Status.UNAUTHORIZED,
        NOT_FOUND             = NetworkUtils.Status.NOT_FOUND,
        INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR,
    }
}

export default PatchPostComment;
