//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils, type Type } from "@repo/common";
import { SocialPost } from "./model/SocialPost";

//
// List a post's review-thread comments. SENDER-gated.
//
export class GetPostComments extends RestfulEndpoint< GetPostComments.Query, undefined, GetPostComments.Response >
{
    public readonly uri      : string = GetPostComments.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.GET;
    public readonly access   : Access.Role = Access.AccountRole.SENDER;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.PUBLIC;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "listSocialPostComments",
        summary:     "List a post's review comments",
        description: "Lists the review-thread comments on a post.",
        tags:        [ "Social" ],
    };

    constructor( id? : string ) { super( { id: id ?? "" } ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return [ { field: "id", location: RestfulEndpoint.AttrLocation.URI, required: true } ]; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema():  RestfulEndpoint.Schema | null { return null; }
}

export namespace GetPostComments
{
    export const URI : string = apiPath( "social", 1, "/posts/:id/comments" );

    export interface Query { id : Type.UUID; }
    export interface Response { comments : Array<SocialPost.ReviewComment>; }

    export enum Error
    {
        UNAUTHORIZED          = NetworkUtils.Status.UNAUTHORIZED,
        INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR,
    }
}

export default GetPostComments;
