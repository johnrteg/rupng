//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils, type Type } from "@repo/common";
import { SocialPost } from "./model/SocialPost";

//
// Preview the per-platform rendition of a post for each of its targets, without publishing.
// SENDER-gated.
//
export class GetPostRenditions extends RestfulEndpoint< GetPostRenditions.Query, undefined, GetPostRenditions.Response >
{
    public readonly uri      : string = GetPostRenditions.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.GET;
    public readonly access   : Access.Role = Access.AccountRole.SENDER;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.PUBLIC;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "getSocialPostRenditions",
        summary:     "Preview per-platform renditions",
        description: "Renders a post's content per target platform, without publishing.",
        tags:        [ "Social" ],
        errors:      { 404: "No such post in this account" },
    };

    constructor( id? : string ) { super( { id: id ?? "" } ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return [ { field: "id", location: RestfulEndpoint.AttrLocation.URI, required: true } ]; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema():  RestfulEndpoint.Schema | null { return null; }
}

export namespace GetPostRenditions
{
    export const URI : string = apiPath( "social", 1, "/posts/:id/renditions" );

    export interface Query { id : Type.UUID; }
    export interface Response { renditions : Array<SocialPost.Rendition>; }

    export enum Error
    {
        UNAUTHORIZED          = NetworkUtils.Status.UNAUTHORIZED,
        NOT_FOUND             = NetworkUtils.Status.NOT_FOUND,
        INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR,
    }
}

export default GetPostRenditions;
