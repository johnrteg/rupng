//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";

// Create a new SVG project from a template — copies the template's S3 doc JSON to a fresh project key and
// creates the SvgProject row. The template itself is never modified; the copy is the user's editable project.
export class PostSvgFromTemplate extends RestfulEndpoint<PostSvgFromTemplate.Query, PostSvgFromTemplate.Body, PostSvgFromTemplate.Response>
{
    public readonly uri      : string = PostSvgFromTemplate.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.POST;
    public readonly access   : Access.Role = Access.AccountRole.USER;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    constructor( templateId? : string, body? : PostSvgFromTemplate.Body ) { super( { templateId: templateId ?? "" }, body ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap>
    {
        return [ { field: "templateId", location: RestfulEndpoint.AttrLocation.URI, required: true } ];
    }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null
    {
        return {
            type: "object", additionalProperties: false, required: [ "name" ],
            properties: { name: { type: "string", minLength: 1, maxLength: 200 } },
        };
    }
}

export namespace PostSvgFromTemplate
{
    export const URI : string = apiPath( "media", 1, "/svg/templates/:templateId/create" );
    export interface Query { templateId : string; }
    export interface Body extends RestfulEndpoint.AuthRequest { name : string; }
    export interface Response { projectId : string; }
    export enum Error { BAD_REQUEST = NetworkUtils.Status.BAD_REQUEST, UNAUTHORIZED = NetworkUtils.Status.UNAUTHORIZED, NOT_FOUND = NetworkUtils.Status.NOT_FOUND, INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR }
}

export default PostSvgFromTemplate;
