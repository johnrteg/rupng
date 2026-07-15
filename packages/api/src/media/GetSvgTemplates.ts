//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import { SvgTemplate } from "./model/SvgTemplate";

// List available document templates — system (platform, read-only) + the requesting account's own — optionally
// filtered by category. Returns summaries only (no doc body) so the gallery stays light.
export class GetSvgTemplates extends RestfulEndpoint<GetSvgTemplates.Query, undefined, GetSvgTemplates.Response>
{
    public readonly uri      : string = GetSvgTemplates.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.GET;
    public readonly access   : Access.Role = Access.AccountRole.USER;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    constructor( category? : SvgTemplate.Category ) { super( { category } ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap>
    {
        return [ { field: "category", location: RestfulEndpoint.AttrLocation.QUERY_PARAM, required: false } ];
    }
    public getQuerySchema(): RestfulEndpoint.Schema | null
    {
        return {
            type: "object", additionalProperties: false,
            properties: { category: { type: "string", enum: Object.values( SvgTemplate.Category ) } },
        };
    }
    public getBodySchema():  RestfulEndpoint.Schema | null { return null; }
}

export namespace GetSvgTemplates
{
    export const URI : string = apiPath( "media", 1, "/svg/templates" );
    export interface Query { category? : SvgTemplate.Category; }   // omitted / null = all categories
    export interface Response { templates : Array<SvgTemplate.Summary>; }
    export enum Error { BAD_REQUEST = NetworkUtils.Status.BAD_REQUEST, UNAUTHORIZED = NetworkUtils.Status.UNAUTHORIZED, INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR }
}

export default GetSvgTemplates;
