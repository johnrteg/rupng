//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";

// Extract a VIDEO asset's audio track into an `audio` variant on the same asset (ffmpeg). Async: enqueues a
// job (shares the media-transcribe queue, op:"extract") and returns 202; the Job adds the AUDIO item + emits
// `media.job` (extract-audio) stage events. The client polls GET /assets/:guid for the new variant. 409 when
// the asset isn't a video.
export class PostAssetExtractAudio extends RestfulEndpoint<PostAssetExtractAudio.Query, undefined, PostAssetExtractAudio.Response>
{
    public readonly uri      : string = PostAssetExtractAudio.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.POST;
    public readonly access   : Access.Role = Access.AccountRole.USER;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    constructor( guid? : string ) { super( { guid: guid ?? "" } ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return [ { field: "guid", location: RestfulEndpoint.AttrLocation.URI, required: true } ]; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema():  RestfulEndpoint.Schema | null { return null; }
}

export namespace PostAssetExtractAudio
{
    export const URI : string = apiPath( "media", 1, "/assets/:guid/extract-audio" );
    export interface Query { guid : string; }
    export interface Response { accepted : boolean; }
    export enum Error
    {
        BAD_REQUEST  = NetworkUtils.Status.BAD_REQUEST,
        UNAUTHORIZED = NetworkUtils.Status.UNAUTHORIZED,
        NOT_FOUND    = NetworkUtils.Status.NOT_FOUND,
        CONFLICT     = NetworkUtils.Status.CONFLICT,   // not a video asset
    }
}

export default PostAssetExtractAudio;
