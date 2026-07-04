//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import { Media } from "./model/Media";

// Overwrite the TEXT content of an item within an envelope (media-18) — used by the caption editor to save an
// edited `.srt`/`.vtt` (or any text item). Writes the new bytes to the item's S3 key and bumps its `version`
// (S3 versioning keeps the prior text — revertable via GetItemVersions/PostItemRevert). `item` is the item key
// `usage[.profile]` (e.g. "transcript.srt"). Returns the updated envelope.
export class PostItemText extends RestfulEndpoint<PostItemText.Query, PostItemText.Body, PostItemText.Response>
{
    public readonly uri      : string = PostItemText.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.POST;
    public readonly access   : Access.Role = Access.AccountRole.USER;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    constructor( guid? : string, body? : PostItemText.Body ) { super( { guid: guid ?? "" }, body ?? { item: "", text: "" } ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return [ { field: "guid", location: RestfulEndpoint.AttrLocation.URI, required: true } ]; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null
    {
        return { type: "object", additionalProperties: false, required: [ "item", "text" ], properties: {
            item: { type: "string", minLength: 1 },
            text: { type: "string" },
        } };
    }
}

export namespace PostItemText
{
    export const URI : string = apiPath( "media", 1, "/assets/:guid/item-text" );
    export interface Query { guid : string; }
    export interface Body extends RestfulEndpoint.AuthRequest { item : string; text : string; }   // item key `usage[.profile]` + the new text
    export interface Response { asset : Media.Asset; }
    export enum Error { BAD_REQUEST = NetworkUtils.Status.BAD_REQUEST, UNAUTHORIZED = NetworkUtils.Status.UNAUTHORIZED, NOT_FOUND = NetworkUtils.Status.NOT_FOUND, INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR }
}

export default PostItemText;
