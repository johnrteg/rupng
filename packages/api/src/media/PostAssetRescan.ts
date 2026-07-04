//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import { Media } from "./model/Media";

// Re-probe an asset's content metadata (media-4) — the UI "rescan" action. Re-reads the original bytes and
// refreshes the type-specific stats (image → sharp, video → ffprobe); variants are left untouched. Async:
// enqueues the re-probe and returns the current asset; the client polls GET /assets/:guid until it settles.
export class PostAssetRescan extends RestfulEndpoint<PostAssetRescan.Query, PostAssetRescan.Body, PostAssetRescan.Response>
{
    public readonly uri      : string = PostAssetRescan.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.POST;
    public readonly access   : Access.Role = Access.AccountRole.USER;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    constructor( guid? : string ) { super( { guid: guid ?? "" }, {} ); }   // empty body ({}) — a null-body POST trips the server body parser
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return [ { field: "guid", location: RestfulEndpoint.AttrLocation.URI, required: true } ]; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null { return null; }
}

export namespace PostAssetRescan
{
    export const URI : string = apiPath( "media", 1, "/assets/:guid/rescan" );
    export interface Query { guid : string; }
    export interface Body extends RestfulEndpoint.AuthRequest {}
    export interface Response { asset : Media.Asset; }
    export enum Error { BAD_REQUEST = NetworkUtils.Status.BAD_REQUEST, UNAUTHORIZED = NetworkUtils.Status.UNAUTHORIZED, NOT_FOUND = NetworkUtils.Status.NOT_FOUND, INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR }
}

export default PostAssetRescan;
