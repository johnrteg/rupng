//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import { Media } from "./model/Media";

// Regenerate a VIDEO's poster thumbnail from a specific frame (`atSeconds`) — the UI "set poster frame"
// action. Extracts that frame and replaces the `poster` variant. Async: enqueues the work + returns the
// current asset; the client polls GET /assets/:guid until the poster refreshes. Video assets only.
export class PostAssetPoster extends RestfulEndpoint<PostAssetPoster.Query, PostAssetPoster.Body, PostAssetPoster.Response>
{
    public readonly uri      : string = PostAssetPoster.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.POST;
    public readonly access   : Access.Role = Access.AccountRole.USER;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    constructor( guid? : string, body? : PostAssetPoster.Body ) { super( { guid: guid ?? "" }, body ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return [ { field: "guid", location: RestfulEndpoint.AttrLocation.URI, required: true } ]; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null
    {
        return { type: "object", additionalProperties: false, required: [ "atSeconds" ], properties: {
            atSeconds: { type: "number", minimum: 0 },
        } };
    }
}

export namespace PostAssetPoster
{
    export const URI : string = apiPath( "media", 1, "/assets/:guid/poster" );
    export interface Query { guid : string; }
    export interface Body extends RestfulEndpoint.AuthRequest { atSeconds : number; }   // frame time (seconds) to capture
    export interface Response { asset : Media.Asset; }
    export enum Error { BAD_REQUEST = NetworkUtils.Status.BAD_REQUEST, UNAUTHORIZED = NetworkUtils.Status.UNAUTHORIZED, NOT_FOUND = NetworkUtils.Status.NOT_FOUND, INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR }
}

export default PostAssetPoster;
