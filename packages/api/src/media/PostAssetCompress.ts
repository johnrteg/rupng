//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";

// Compress a VIDEO to a named distribution target (media-10.10) — mms / mobile / web-sd / web-hd / hevc-hd
// (from MediaConfig.videoTargets). Async (media-19): enqueues the media-video Job (ffmpeg CRF ladder) and
// returns 202; the result is stored as a `compressed.<target>` variant. Poll GET /assets/:guid / stage events.
export class PostAssetCompress extends RestfulEndpoint<PostAssetCompress.Query, PostAssetCompress.Body, PostAssetCompress.Response>
{
    public readonly uri      : string = PostAssetCompress.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.POST;
    public readonly access   : Access.Role = Access.AccountRole.USER;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    constructor( guid? : string, body? : PostAssetCompress.Body ) { super( { guid: guid ?? "" }, body ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return [ { field: "guid", location: RestfulEndpoint.AttrLocation.URI, required: true } ]; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema():  RestfulEndpoint.Schema | null
    {
        return { type: "object", additionalProperties: false, required: [ "target" ], properties: {
            target: { type: "string", minLength: 1 },   // a key in MediaConfig.videoTargets
        } };
    }
}

export namespace PostAssetCompress
{
    export const URI : string = apiPath( "media", 1, "/assets/:guid/compress" );
    export interface Query { guid : string; }
    export interface Body extends RestfulEndpoint.AuthRequest { target : string; }
    export interface Response { accepted : boolean; }
    export enum Error
    {
        BAD_REQUEST  = NetworkUtils.Status.BAD_REQUEST,   // unknown target
        UNAUTHORIZED = NetworkUtils.Status.UNAUTHORIZED,
        NOT_FOUND    = NetworkUtils.Status.NOT_FOUND,
        CONFLICT     = NetworkUtils.Status.CONFLICT,      // not a video
    }
}

export default PostAssetCompress;
