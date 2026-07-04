//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import { Media } from "./model/Media";

// Render an image to a configured DPI/density target (media-4) — produces a DENSITY item keyed
// `density.<target>` (e.g. `density.print`). The target is one of the configured densities (GET /media/densities).
// Small + synchronous (sharp), so it returns the updated envelope directly (no async job).
export class PostAssetDensity extends RestfulEndpoint<PostAssetDensity.Query, PostAssetDensity.Body, PostAssetDensity.Response>
{
    public readonly uri      : string = PostAssetDensity.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.POST;
    public readonly access   : Access.Role = Access.AccountRole.USER;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    constructor( guid? : string, body? : PostAssetDensity.Body ) { super( { guid: guid ?? "" }, body ?? { density: "" } ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return [ { field: "guid", location: RestfulEndpoint.AttrLocation.URI, required: true } ]; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null
    {
        return { type: "object", additionalProperties: false, required: [ "density" ], properties: {
            density: { type: "string", minLength: 1, maxLength: 100 },   // the configured density key (e.g. "print")
        } };
    }
}

export namespace PostAssetDensity
{
    export const URI : string = apiPath( "media", 1, "/assets/:guid/density" );
    export interface Query { guid : string; }
    export interface Body extends RestfulEndpoint.AuthRequest { density : string; }
    export interface Response { asset : Media.Asset; }
    export enum Error { BAD_REQUEST = NetworkUtils.Status.BAD_REQUEST, UNAUTHORIZED = NetworkUtils.Status.UNAUTHORIZED, NOT_FOUND = NetworkUtils.Status.NOT_FOUND, INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR }
}

export default PostAssetDensity;
