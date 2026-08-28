//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import { StudioProject } from "./model/StudioProject";

// Burn a VIDEO asset's transcript captions onto the video itself (media-2x). Async: enqueues a
// `media-caption-burn` Job (ffmpeg drawtext overlay per timed line, reusing the Studio render compositor) and
// returns 202; the Job saves the result as a NEW `Usage.CAPTIONED` item on the SAME asset (never a new asset),
// stamped with the exact transcript item + version it was burned from. The client polls GET /assets/:guid.
export class PostAssetBurnCaptions extends RestfulEndpoint<PostAssetBurnCaptions.Query, PostAssetBurnCaptions.Body, PostAssetBurnCaptions.Response>
{
    public readonly uri      : string = PostAssetBurnCaptions.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.POST;
    public readonly access   : Access.Role = Access.AccountRole.USER;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    constructor( guid? : string, body? : PostAssetBurnCaptions.Body ) { super( { guid: guid ?? "" }, body ?? { transcriptItem: "" } ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return [ { field: "guid", location: RestfulEndpoint.AttrLocation.URI, required: true } ]; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null
    {
        return { type: "object", additionalProperties: false, required: [ "transcriptItem" ], properties: {
            transcriptItem: { type: "string", minLength: 1 },   // the .srt/.vtt item key (`usage[.profile]`), e.g. "transcript.srt"
            style: { type: "object" },                          // a StudioProject.TextStyle (validated loosely; normalized in the impl)
            position: { type: "string", enum: [ "top", "bottom" ] },
            fontPct: { type: "number" },
        } };
    }
}

export namespace PostAssetBurnCaptions
{
    export const URI : string = apiPath( "media", 1, "/assets/:guid/burn-captions" );
    export interface Query { guid : string; }
    export interface Body extends RestfulEndpoint.AuthRequest
    {
        transcriptItem : string;                   // the .srt/.vtt item key being burned in
        style?         : StudioProject.TextStyle;  // font / color / outline / background (defaults if omitted)
        position?      : "top" | "bottom";         // caption bar placement (default "bottom")
        fontPct?       : number;                   // font size as a fraction of frame height (default per CAPTION_GEOMETRY)
    }
    export interface Response { accepted : boolean; }
    export enum Error
    {
        BAD_REQUEST  = NetworkUtils.Status.BAD_REQUEST,
        UNAUTHORIZED = NetworkUtils.Status.UNAUTHORIZED,
        NOT_FOUND    = NetworkUtils.Status.NOT_FOUND,
        CONFLICT     = NetworkUtils.Status.CONFLICT,   // not a video asset / transcript item not found
    }
}

export default PostAssetBurnCaptions;
