//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import { Media } from "./model/Media";
import { StudioProject } from "./model/StudioProject";

// Create a Studio project. The service stamps accountId / timestamps / actor; the client supplies the name,
// media kind, optional campaign, initial tags, and page. Returns the created record.
export class PostStudioProject extends RestfulEndpoint<{}, PostStudioProject.Body, PostStudioProject.Response>
{
    public readonly uri      : string = PostStudioProject.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.POST;
    public readonly access   : Access.Role = Access.AccountRole.USER;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    constructor( body? : PostStudioProject.Body ) { super( {}, body ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return []; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null
    {
        return {
            type: "object", additionalProperties: false, required: [ "name", "kind" ],
            properties: {
                name:       { type: "string", minLength: 1, maxLength: 200 },
                kind:       { type: "string", enum: Object.values( Media.Kind ) },
                campaignId: { type: "string" },
                tags:       { type: "array", items: { type: "string" } },
                page:       PostStudioProject.PAGE_SCHEMA,
            },
        };
    }
}

export namespace PostStudioProject
{
    export const URI : string = apiPath( "media", 1, "/projects" );

    /** Shared page-object schema (also used by PatchStudioProject). */
    export const PAGE_SCHEMA : RestfulEndpoint.Schema =
    {
        type: "object", additionalProperties: false, required: [ "unit", "width", "height", "dpi" ],
        properties: {
            unit:   { type: "string", enum: Object.values( StudioProject.PageUnit ) },
            width:  { type: "number", minimum: 1 },
            height: { type: "number", minimum: 1 },
            dpi:    { type: "number", minimum: 1 },
        },
    };

    export interface Body extends RestfulEndpoint.AuthRequest
    {
        name        : string;
        kind        : Media.Kind;
        campaignId? : string;
        tags?       : Array<string>;
        page?       : StudioProject.PageSpec;
    }
    export interface Response { project : StudioProject.Entity; }
    export enum Error { BAD_REQUEST = NetworkUtils.Status.BAD_REQUEST, UNAUTHORIZED = NetworkUtils.Status.UNAUTHORIZED, INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR }
}

export default PostStudioProject;
