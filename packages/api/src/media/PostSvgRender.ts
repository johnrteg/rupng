//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import { SvgDocument } from "./model/SvgDocument";

// Trigger an async export render (SvgDocument → SVG → PNG/PDF/JPEG via the server-side pipeline). Heavy work,
// so it enqueues a job and returns the jobId immediately; the client polls GetSvgRenderJob until done.
export class PostSvgRender extends RestfulEndpoint<{}, PostSvgRender.Body, PostSvgRender.Response>
{
    public readonly uri      : string = PostSvgRender.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.POST;
    public readonly access   : Access.Role = Access.AccountRole.USER;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    constructor( body? : PostSvgRender.Body ) { super( {}, body ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return []; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null
    {
        return {
            type: "object", additionalProperties: false, required: [ "projectId", "settings" ],
            properties: {
                projectId: { type: "string", minLength: 1 },
                pageIds:   { type: [ "array", "null" ], items: { type: "string" } },   // null = all pages
                settings:  { type: "object" },                                          // SvgDocument.ExportSettings
            },
        };
    }
}

export namespace PostSvgRender
{
    export const URI : string = apiPath( "media", 1, "/svg/render" );
    export interface Body extends RestfulEndpoint.AuthRequest
    {
        projectId : string;
        pageIds   : Array<string> | null;    // null = all pages
        settings  : SvgDocument.ExportSettings;
    }
    export interface Response { jobId : string; }   // async — poll GetSvgRenderJob
    export enum Error { BAD_REQUEST = NetworkUtils.Status.BAD_REQUEST, UNAUTHORIZED = NetworkUtils.Status.UNAUTHORIZED, NOT_FOUND = NetworkUtils.Status.NOT_FOUND, INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR }
}

export default PostSvgRender;
