//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import { Media } from "./model/Media";

// Replace an existing asset's ORIGINAL bytes IN PLACE — same guid, same S3 object key (the versioned bucket
// keeps prior versions). Presigns a PUT to the original key and flips the asset back to UPLOADING; the client
// PUTs the new bytes then calls PostUploadComplete to re-run scan → process (regenerating derived variants).
// Used by Studio "Save to Library": re-saving a composite UPDATES the same library item instead of minting a
// new asset each time (the project remembers the asset guid).
export class PostAssetReplace extends RestfulEndpoint<PostAssetReplace.Query, PostAssetReplace.Body, PostAssetReplace.Response>
{
    public readonly uri      : string = PostAssetReplace.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.POST;
    public readonly access   : Access.Role = Access.AccountRole.USER;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    constructor( guid? : string, body? : PostAssetReplace.Body ) { super( { guid: guid ?? "" }, body ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap>
    {
        return [ { field: "guid", location: RestfulEndpoint.AttrLocation.URI, required: true } ];
    }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null
    {
        return {
            type: "object", additionalProperties: false, required: [ "size" ],
            properties: {
                size: { type: "number", minimum: 1 },
                mime: { type: "string", minLength: 1 },
            },
        };
    }
}

export namespace PostAssetReplace
{
    export const URI : string = apiPath( "media", 1, "/assets/:guid/replace" );
    export interface Query { guid : string; }
    export interface Body extends RestfulEndpoint.AuthRequest
    {
        size  : number;      // byte size of the new original
        mime? : string;      // new mime, if it changed (else the existing original's mime is kept)
    }
    export interface Response { asset : Media.Asset; upload : { url : string; method : string; expiresAt : string }; }
    export enum Error { BAD_REQUEST = NetworkUtils.Status.BAD_REQUEST, UNAUTHORIZED = NetworkUtils.Status.UNAUTHORIZED, FORBIDDEN = NetworkUtils.Status.FORBIDDEN, NOT_FOUND = NetworkUtils.Status.NOT_FOUND, INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR }
}

export default PostAssetReplace;
