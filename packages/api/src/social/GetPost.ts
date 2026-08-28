//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils, type Type } from "@repo/common";
import { SocialPost } from "./model/SocialPost";

//
// Fetch a single post by id (tenant-scoped), including its `PublishedPost` results per target.
// SENDER-gated.
//
export class GetPost extends RestfulEndpoint< GetPost.Query, undefined, GetPost.Response >
{
    public readonly uri      : string = GetPost.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.GET;
    public readonly access   : Access.Role = Access.AccountRole.SENDER;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.PUBLIC;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "getSocialPost",
        summary:     "Get a post",
        description: "Fetches a single post + its per-target publish results.",
        tags:        [ "Social" ],
        errors:      { 404: "No such post in this account" },
    };

    constructor( id? : string ) { super( { id: id ?? "" } ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return [ { field: "id", location: RestfulEndpoint.AttrLocation.URI, required: true } ]; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema():  RestfulEndpoint.Schema | null { return null; }
}

export namespace GetPost
{
    export const URI : string = apiPath( "social", 1, "/posts/:id" );

    export interface Query { id : Type.UUID; }

    export interface Response extends SocialPost.Entity
    {
        published? : Array<SocialPost.PublishedPost>;
    }

    export enum Error
    {
        UNAUTHORIZED          = NetworkUtils.Status.UNAUTHORIZED,
        NOT_FOUND             = NetworkUtils.Status.NOT_FOUND,
        INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR,
    }
}

export default GetPost;
