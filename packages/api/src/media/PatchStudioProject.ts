//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import { StudioProject } from "./model/StudioProject";
import { PostStudioProject } from "./PostStudioProject";

// Update a Studio project's mutable fields (name / tags / campaign / page / the saved library asset). Any
// subset may be supplied; the service re-stamps modifiedAt + modifiedBy. Returns the updated record.
export class PatchStudioProject extends RestfulEndpoint<PatchStudioProject.Query, PatchStudioProject.Body, PatchStudioProject.Response>
{
    public readonly uri      : string = PatchStudioProject.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.PATCH;
    public readonly access   : Access.Role = Access.AccountRole.USER;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    constructor( id? : string, body? : PatchStudioProject.Body ) { super( { id: id ?? "" }, body ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap>
    {
        return [ { field: "id", location: RestfulEndpoint.AttrLocation.URI, required: true } ];
    }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null
    {
        return {
            type: "object", additionalProperties: false,
            properties: {
                name:           { type: "string", minLength: 1, maxLength: 200 },
                tags:           { type: "array", items: { type: "string" } },
                campaignId:     { type: "string" },
                libraryAssetId: { type: "string" },
                page:           PostStudioProject.PAGE_SCHEMA,
            },
        };
    }
}

export namespace PatchStudioProject
{
    export const URI : string = apiPath( "media", 1, "/projects/:id" );
    export interface Query { id : string; }
    export interface Body extends RestfulEndpoint.AuthRequest
    {
        name?           : string;
        tags?           : Array<string>;
        campaignId?     : string;
        libraryAssetId? : string;
        page?           : StudioProject.PageSpec;
    }
    export interface Response { project : StudioProject.Entity; }
    export enum Error { BAD_REQUEST = NetworkUtils.Status.BAD_REQUEST, UNAUTHORIZED = NetworkUtils.Status.UNAUTHORIZED, NOT_FOUND = NetworkUtils.Status.NOT_FOUND, INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR }
}

export default PatchStudioProject;
