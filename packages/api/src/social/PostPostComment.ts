//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils, type Type } from "@repo/common";
import { SocialPost } from "./model/SocialPost";

//
// Add a review-thread comment to a post. SENDER-gated.
//
export class PostPostComment extends RestfulEndpoint< PostPostComment.Query, PostPostComment.Body, PostPostComment.Response >
{
    public readonly uri      : string = PostPostComment.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.POST;
    public readonly access   : Access.Role = Access.AccountRole.SENDER;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.PUBLIC;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "createSocialPostComment",
        summary:     "Add a review comment",
        description: "Adds a comment to a post's review thread.",
        tags:        [ "Social" ],
        errors:      { 404: "No such post in this account" },
    };

    constructor( id? : string, body? : PostPostComment.Body ) { super( { id: id ?? "" }, body ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return [ { field: "id", location: RestfulEndpoint.AttrLocation.URI, required: true } ]; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null
    { return { type: "object", additionalProperties: false, required: [ "text" ], properties: { text: { type: "string", minLength: 1 } } }; }
}

export namespace PostPostComment
{
    export const URI : string = apiPath( "social", 1, "/posts/:id/comments" );

    export interface Query { id : Type.UUID; }
    export interface Body extends RestfulEndpoint.AuthRequest { text : string; }
    export interface Response extends SocialPost.ReviewComment {}

    export enum Error
    {
        BAD_REQUEST           = NetworkUtils.Status.BAD_REQUEST,
        UNAUTHORIZED          = NetworkUtils.Status.UNAUTHORIZED,
        NOT_FOUND             = NetworkUtils.Status.NOT_FOUND,
        INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR,
    }
}

export default PostPostComment;
