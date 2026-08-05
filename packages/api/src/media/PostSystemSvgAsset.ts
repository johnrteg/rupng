//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import { SvgAsset } from "./model/SvgAsset";

// Add an SVG graphic to the platform-wide (SYSTEM) library, visible read-only to every account — root/platform-
// admin only. Same create shape as PostSvgAsset (raw markup or a Browse provider pick); differs only in which
// owner partition the row lands in.
export class PostSystemSvgAsset extends RestfulEndpoint<{}, PostSystemSvgAsset.Body, PostSystemSvgAsset.Response>
{
    public readonly uri      : string = PostSystemSvgAsset.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.POST;
    public readonly access   : Access.Role = Access.AppRole.ROOT;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    constructor( body? : PostSystemSvgAsset.Body ) { super( {}, body ); }
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

export namespace PostSystemSvgAsset
{
    export const URI : string = apiPath( "media", 1, "/svg/assets/system" );
    export interface Body extends RestfulEndpoint.AuthRequest, SvgAsset.CreateBody {}
    export interface Response { assetId : string; svg : string; }
    export enum Error { BAD_REQUEST = NetworkUtils.Status.BAD_REQUEST, UNAUTHORIZED = NetworkUtils.Status.UNAUTHORIZED, INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR }
}

export default PostSystemSvgAsset;
