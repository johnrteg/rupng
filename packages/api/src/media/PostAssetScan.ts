//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import { Media } from "./model/Media";

// Re-run the malware scan on an asset's ORIGINAL bytes (media-5) — the UI "re-scan" action. Puts the envelope
// back into SCANNING and re-enqueues the media-scan gate; the Job re-scans and records a fresh Media.ScanResult
// (and quarantines on a detection). Async: returns the current asset; the client polls GET /assets/:guid.
// Distinct from `rescan`, which only RE-PROBES content metadata (no malware scan).
export class PostAssetScan extends RestfulEndpoint<PostAssetScan.Query, PostAssetScan.Body, PostAssetScan.Response>
{
    public readonly uri      : string = PostAssetScan.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.POST;
    public readonly access   : Access.Role = Access.AccountRole.USER;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    constructor( guid? : string ) { super( { guid: guid ?? "" }, {} ); }   // empty body ({}) — a null-body POST trips the server body parser
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return [ { field: "guid", location: RestfulEndpoint.AttrLocation.URI, required: true } ]; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null { return null; }
}

export namespace PostAssetScan
{
    export const URI : string = apiPath( "media", 1, "/assets/:guid/scan" );
    export interface Query { guid : string; }
    export interface Body extends RestfulEndpoint.AuthRequest {}
    export interface Response { asset : Media.Asset; }
    export enum Error { BAD_REQUEST = NetworkUtils.Status.BAD_REQUEST, UNAUTHORIZED = NetworkUtils.Status.UNAUTHORIZED, NOT_FOUND = NetworkUtils.Status.NOT_FOUND, INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR }
}

export default PostAssetScan;
