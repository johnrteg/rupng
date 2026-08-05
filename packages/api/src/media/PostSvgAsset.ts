//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import { SvgAsset } from "./model/SvgAsset";

// Add an SVG graphic to the ACCOUNT's own library — either raw markup (direct upload) or a Browse provider
// pick (SVGL/Iconify icon+logo catalogs). The markup is sanitized before storage. System-wide (platform)
// assets are a separate root-gated endpoint (PostSystemSvgAsset) — never created here.
export class PostSvgAsset extends RestfulEndpoint<{}, PostSvgAsset.Body, PostSvgAsset.Response>
{
    public readonly uri      : string = PostSvgAsset.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.POST;
    public readonly access   : Access.Role = Access.AccountRole.USER;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    constructor( body? : PostSvgAsset.Body ) { super( {}, body ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return []; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null
    {
        return {
            type: "object", additionalProperties: false, required: [ "name" ],
            properties: {
                name:       { type: "string", minLength: 1, maxLength: 200 },
                tags:       { type: "array", items: { type: "string" } },
                svg:        { type: "string", minLength: 1 },
                provider:   { type: "string" },
                externalId: { type: "string" },
            },
        };
    }
}

export namespace PostSvgAsset
{
    export const URI : string = apiPath( "media", 1, "/svg/assets" );
    export interface Body extends RestfulEndpoint.AuthRequest, SvgAsset.CreateBody {}
    export interface Response { assetId : string; svg : string; }   // svg = the sanitized markup, so the caller can place it without a second fetch
    export enum Error { BAD_REQUEST = NetworkUtils.Status.BAD_REQUEST, UNAUTHORIZED = NetworkUtils.Status.UNAUTHORIZED, INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR }
}

export default PostSvgAsset;
