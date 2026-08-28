//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils, type Type } from "@repo/common";

//
// Cancel a scheduled (unpublished) post — status → CANCELED. A post already published cannot be
// canceled (nothing to undo upstream). SENDER-gated.
//
export class DeletePost extends RestfulEndpoint< DeletePost.Query, undefined, DeletePost.Response >
{
    public readonly uri      : string = DeletePost.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.DELETE;
    public readonly access   : Access.Role = Access.AccountRole.SENDER;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.PUBLIC;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "cancelSocialPost",
        summary:     "Cancel a scheduled post",
        description: "Cancels a scheduled, not-yet-published post.",
        tags:        [ "Social" ],
        errors:      { 404: "No such post in this account", 409: "Post already published" },
    };

    constructor( id? : string ) { super( { id: id ?? "" } ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return [ { field: "id", location: RestfulEndpoint.AttrLocation.URI, required: true } ]; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema():  RestfulEndpoint.Schema | null { return null; }
}

export namespace DeletePost
{
    export const URI : string = apiPath( "social", 1, "/posts/:id" );

    export interface Query { id : Type.UUID; }
    export interface Response { id : Type.UUID; canceled : boolean; }

    export enum Error
    {
        UNAUTHORIZED          = NetworkUtils.Status.UNAUTHORIZED,
        NOT_FOUND             = NetworkUtils.Status.NOT_FOUND,
        CONFLICT              = NetworkUtils.Status.CONFLICT,
        INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR,
    }
}

export default DeletePost;
