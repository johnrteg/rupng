//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import { Media } from "./model/Media";

// Revert an ITEM to a prior S3 version (media-1.4) — copies the chosen version back onto the current key
// (writing a NEW latest version; nothing is destroyed) and bumps the item's `version`. `item` is the item key
// `usage[.profile]`; `versionId` is one returned by GetItemVersions. Returns the updated envelope.
export class PostItemRevert extends RestfulEndpoint<PostItemRevert.Query, PostItemRevert.Body, PostItemRevert.Response>
{
    public readonly uri      : string = PostItemRevert.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.POST;
    public readonly access   : Access.Role = Access.AccountRole.USER;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    constructor( guid? : string, body? : PostItemRevert.Body ) { super( { guid: guid ?? "" }, body ?? { item: "", versionId: "" } ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return [ { field: "guid", location: RestfulEndpoint.AttrLocation.URI, required: true } ]; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null
    {
        return { type: "object", additionalProperties: false, required: [ "item", "versionId" ], properties: {
            item:      { type: "string", minLength: 1 },
            versionId: { type: "string", minLength: 1 },
        } };
    }
}

export namespace PostItemRevert
{
    export const URI : string = apiPath( "media", 1, "/assets/:guid/revert" );
    export interface Query { guid : string; }
    export interface Body extends RestfulEndpoint.AuthRequest { item : string; versionId : string; }
    export interface Response { asset : Media.Asset; }
    export enum Error { BAD_REQUEST = NetworkUtils.Status.BAD_REQUEST, UNAUTHORIZED = NetworkUtils.Status.UNAUTHORIZED, NOT_FOUND = NetworkUtils.Status.NOT_FOUND, INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR }
}

export default PostItemRevert;
