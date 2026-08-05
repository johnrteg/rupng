//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import { StudioProject } from "./model/StudioProject";

// Copy a Studio project — clone its metadata (name/kind/campaign/tags/page) AND its canvas snapshot into a
// NEW project. The copy never inherits `libraryAssetId` (a fresh project hasn't saved a composite yet).
export class PostStudioProjectCopy extends RestfulEndpoint<PostStudioProjectCopy.Query, PostStudioProjectCopy.Body, PostStudioProjectCopy.Response>
{
    public readonly uri      : string = PostStudioProjectCopy.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.POST;
    public readonly access   : Access.Role = Access.AccountRole.USER;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "copyStudioProject",
        summary:     "Copy a Studio project",
        description: "Clones a Studio project's metadata and canvas snapshot into a new project.",
        tags:        [ "Media" ],
        errors:      { 404: "No such project in this account" },
    };

    constructor( id? : string, body? : PostStudioProjectCopy.Body ) { super( { id: id ?? "" }, body ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return [ { field: "id", location: RestfulEndpoint.AttrLocation.URI, required: true } ]; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null
    {
        return {
            type: "object", additionalProperties: false,
            properties: { name: { type: "string" } },
        };
    }
}

export namespace PostStudioProjectCopy
{
    export const URI : string = apiPath( "media", 1, "/projects/:id/copy" );

    export interface Query { id : string; }
    export interface Body extends RestfulEndpoint.AuthRequest
    {
        name? : string;   // new name (defaults to "<original> (copy)")
    }
    export interface Response { project : StudioProject.Entity; }

    export enum Error
    {
        UNAUTHORIZED          = NetworkUtils.Status.UNAUTHORIZED,
        NOT_FOUND             = NetworkUtils.Status.NOT_FOUND,
        INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR,
    }
}

export default PostStudioProjectCopy;
