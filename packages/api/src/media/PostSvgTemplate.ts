//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import { SvgTemplate } from "./model/SvgTemplate";

// Save the current project as an ACCOUNT-scoped template — copies the project's S3 doc JSON to the templates
// prefix and creates an account SvgTemplate row. System templates are ops-deployed, never created here.
export class PostSvgTemplate extends RestfulEndpoint<{}, PostSvgTemplate.Body, PostSvgTemplate.Response>
{
    public readonly uri      : string = PostSvgTemplate.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.POST;
    public readonly access   : Access.Role = Access.AccountRole.USER;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    constructor( body? : PostSvgTemplate.Body ) { super( {}, body ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return []; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null
    {
        return {
            type: "object", additionalProperties: false, required: [ "projectId", "name", "category" ],
            properties: {
                projectId: { type: "string", minLength: 1 },
                name:      { type: "string", minLength: 1, maxLength: 200 },
                category:  { type: "string", enum: Object.values( SvgTemplate.Category ) },
                tags:      { type: "array", items: { type: "string" } },
            },
        };
    }
}

export namespace PostSvgTemplate
{
    export const URI : string = apiPath( "media", 1, "/svg/templates" );
    export interface Body extends RestfulEndpoint.AuthRequest
    {
        projectId : string;
        name      : string;
        category  : SvgTemplate.Category;
        tags      : Array<string>;
    }
    export interface Response { templateId : string; }
    export enum Error { BAD_REQUEST = NetworkUtils.Status.BAD_REQUEST, UNAUTHORIZED = NetworkUtils.Status.UNAUTHORIZED, NOT_FOUND = NetworkUtils.Status.NOT_FOUND, INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR }
}

export default PostSvgTemplate;
