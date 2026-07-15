//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";

// Request a download archive (zip of an asset's original + variants) — media-20. Async (media-19): creates a
// PENDING Media.Archive + enqueues the media-archive Job; returns the archiveId. The zip appears in the
// "Downloads" view (GetArchives) with a status; download via GetArchiveUrl when complete.
export class PostAssetArchive extends RestfulEndpoint<PostAssetArchive.Query, undefined, PostAssetArchive.Response>
{
    public readonly uri      : string = PostAssetArchive.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.POST;
    public readonly access   : Access.Role = Access.AccountRole.USER;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    constructor( guid? : string ) { super( { guid: guid ?? "" } ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return [ { field: "guid", location: RestfulEndpoint.AttrLocation.URI, required: true } ]; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema():  RestfulEndpoint.Schema | null { return null; }
}

export namespace PostAssetArchive
{
    export const URI : string = apiPath( "media", 1, "/assets/:guid/archive" );
    export interface Query { guid : string; }
    export interface Response { archiveId : string; }
    export enum Error { BAD_REQUEST = NetworkUtils.Status.BAD_REQUEST, UNAUTHORIZED = NetworkUtils.Status.UNAUTHORIZED, NOT_FOUND = NetworkUtils.Status.NOT_FOUND, INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR }
}

export default PostAssetArchive;
