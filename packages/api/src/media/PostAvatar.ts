//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import { Media } from "./model/Media";

// Set/replace the acting user's AVATAR (media-23): given an already-uploaded USER-scope image envelope + a
// normalized crop rect (the pan/zoom framing under the circular overlay), store the crop on the envelope and
// (re)generate the square AVATAR variants (xl→xs) via the media pipeline. The ORIGINAL photo is kept. HEAVY
// crop+resize runs as the media-process Job, so this endpoint is thin: validate → stamp crop → enqueue → 202.
// Returns the asset guid the profile references (the caller then stores it on the user via POST /auth/user).
export class PostAvatar extends RestfulEndpoint<{}, PostAvatar.Body, PostAvatar.Response>
{
    public readonly uri      : string = PostAvatar.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.POST;
    public readonly access   : Access.Role = Access.AccountRole.USER;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    constructor( body? : PostAvatar.Body ) { super( {}, body ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return []; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null
    {
        return { type: "object", additionalProperties: false, required: [ "guid", "crop" ], properties: {
            guid: { type: "string", minLength: 1 },
            crop: { type: "object", additionalProperties: false, required: [ "x", "y", "w", "h" ], properties: {
                x: { type: "number" }, y: { type: "number" }, w: { type: "number" }, h: { type: "number" },
            } },
        } };
    }
}

export namespace PostAvatar
{
    export const URI : string = apiPath( "media", 1, "/avatar" );
    export interface Body extends RestfulEndpoint.AuthRequest { guid : string; crop : Media.CropRect; }
    export interface Response { guid : string; queued : boolean; }
    export enum Error { BAD_REQUEST = NetworkUtils.Status.BAD_REQUEST, UNAUTHORIZED = NetworkUtils.Status.UNAUTHORIZED, NOT_FOUND = NetworkUtils.Status.NOT_FOUND, INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR }
}

export default PostAvatar;
