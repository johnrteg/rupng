//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import { Browse } from "./model/Browse";

// Normalized fan-out search across the selected/enabled providers (media-13). Synchronous: the service queries
// all N concurrently (per-provider timeout), then normalizes + merges into one page; per-provider status is
// reported so a slow/failed provider is surfaced, not fatal. (Streaming per-provider is a later, websocket
// enhancement — media-13.8.) Body is the normalized `Browse.Query`.
export class PostBrowseSearch extends RestfulEndpoint<{}, PostBrowseSearch.Body, PostBrowseSearch.Response>
{
    public readonly uri      : string = PostBrowseSearch.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.POST;
    public readonly access   : Access.Role = Access.AccountRole.USER;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    constructor( body? : PostBrowseSearch.Body ) { super( {}, body ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return []; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema():  RestfulEndpoint.Schema | null { return null; }   // validated loosely in the impl (Browse.Query is a rich shape)
}

export namespace PostBrowseSearch
{
    export const URI : string = apiPath( "media", 1, "/browse/search" );
    export interface Body extends RestfulEndpoint.AuthRequest, Browse.Query {}
    export interface Response
    {
        results   : Array<Browse.Result>;
        cursor?   : string;                          // normalized continuation (for "load more")
        providers : Array<Browse.ProviderStatus>;    // per-provider outcome
    }
    export enum Error { BAD_REQUEST = NetworkUtils.Status.BAD_REQUEST, UNAUTHORIZED = NetworkUtils.Status.UNAUTHORIZED, INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR }
}

export default PostBrowseSearch;
