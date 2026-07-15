//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import { Media } from "./model/Media";

// Transcribe an AUDIO/VIDEO asset's speech to text + timed segments (media-18). Async (media-19): enqueues a
// `media-transcribe` Job (extract audio track → Whisper) and returns 202; the Job saves `asset.transcript`
// and emits `media.job` stage events. The client polls GET /assets/:guid for the transcript.
export class PostAssetTranscribe extends RestfulEndpoint<PostAssetTranscribe.Query, undefined, PostAssetTranscribe.Response>
{
    public readonly uri      : string = PostAssetTranscribe.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.POST;
    public readonly access   : Access.Role = Access.AccountRole.USER;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    constructor( guid? : string ) { super( { guid: guid ?? "" } ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return [ { field: "guid", location: RestfulEndpoint.AttrLocation.URI, required: true } ]; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema():  RestfulEndpoint.Schema | null { return null; }
}

export namespace PostAssetTranscribe
{
    export const URI : string = apiPath( "media", 1, "/assets/:guid/transcribe" );
    export interface Query { guid : string; }
    export interface Response { accepted : boolean; }
    export enum Error
    {
        BAD_REQUEST  = NetworkUtils.Status.BAD_REQUEST,
        UNAUTHORIZED = NetworkUtils.Status.UNAUTHORIZED,
        NOT_FOUND    = NetworkUtils.Status.NOT_FOUND,
        CONFLICT     = NetworkUtils.Status.CONFLICT,   // not an audio/video asset
    }
}

export default PostAssetTranscribe;
