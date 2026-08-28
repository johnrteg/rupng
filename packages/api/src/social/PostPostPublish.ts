//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils, type Type } from "@repo/common";
import { SocialPost } from "./model/SocialPost";

//
// Publish a post now (skip/override its schedule). Gated on `approved` status once the approval
// workflow lands (`approvalsRequired ≥ 1`) — un-gated for this initial cut. SENDER-gated.
//
export class PostPostPublish extends RestfulEndpoint< PostPostPublish.Query, undefined, PostPostPublish.Response >
{
    public readonly uri      : string = PostPostPublish.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.POST;
    public readonly access   : Access.Role = Access.AccountRole.SENDER;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.PUBLIC;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "publishSocialPost",
        summary:     "Publish a post now",
        description: "Publishes a post immediately, skipping/overriding any schedule.",
        tags:        [ "Social" ],
        errors:      { 404: "No such post in this account", 409: "Post requires approval before publishing" },
    };

    constructor( id? : string ) { super( { id: id ?? "" } ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return [ { field: "id", location: RestfulEndpoint.AttrLocation.URI, required: true } ]; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema():  RestfulEndpoint.Schema | null { return null; }
}

export namespace PostPostPublish
{
    export const URI : string = apiPath( "social", 1, "/posts/:id/publish" );

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

export default PostPostPublish;
