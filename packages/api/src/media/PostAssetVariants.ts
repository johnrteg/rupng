//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import { Media } from "./model/Media";

// Request (re)generation of variant profiles for an asset (media-4.6). A consumer picks a profile from
// GET /media/variant-specs, then POSTs here to have the processor derive that profile's variants (named
// `<profile>[.<label>]`) and merge them into the asset. OMIT `profile` to REBUILD EVERY configured profile
// (a full refresh against the current system config). Async: enqueues the process stage(s) and returns the
// current asset; the client polls GET /assets/:guid/status until the variants report `ready`.
export class PostAssetVariants extends RestfulEndpoint<PostAssetVariants.Query, PostAssetVariants.Body, PostAssetVariants.Response>
{
    public readonly uri      : string = PostAssetVariants.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.POST;
    public readonly access   : Access.Role = Access.AccountRole.USER;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    constructor( guid? : string, body? : PostAssetVariants.Body ) { super( { guid: guid ?? "" }, body ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return [ { field: "guid", location: RestfulEndpoint.AttrLocation.URI, required: true } ]; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null
    {
        // `profile` optional — omitted = rebuild every configured profile (full refresh)
        return { type: "object", additionalProperties: false, properties: {
            profile: { type: "string", minLength: 1, maxLength: 100 },
        } };
    }
}

export namespace PostAssetVariants
{
    export const URI : string = apiPath( "media", 1, "/assets/:guid/variants" );
    export interface Query { guid : string; }
    export interface Body extends RestfulEndpoint.AuthRequest { profile? : string; }   // the profile to derive (e.g. "display", "instagram"); omit = ALL configured profiles
    export interface Response { asset : Media.Asset; }
    export enum Error { BAD_REQUEST = NetworkUtils.Status.BAD_REQUEST, UNAUTHORIZED = NetworkUtils.Status.UNAUTHORIZED, NOT_FOUND = NetworkUtils.Status.NOT_FOUND, INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR }
}

export default PostAssetVariants;
