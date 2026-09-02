//
import { RestfulEndpoint, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import { Search } from "./model/Search";

//
// S2S — trigger a rebuild/backfill of an index (a single type or all) from the owning services' source data
// (search-1.4). Kicks off `SearchReindexJob`'s zero-downtime alias swap; returns immediately (202-style ack),
// the job itself runs async. INTERNAL audience — VPC-only, operator/EventBridge-invoked.
//
export class PostSearchInternalReindex extends RestfulEndpoint< {}, PostSearchInternalReindex.Body, PostSearchInternalReindex.Response >
{
    public readonly uri      : string = PostSearchInternalReindex.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.POST;
    public readonly access   : undefined = undefined;   // S2S (INTERNAL audience) — no RBAC role
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.INTERNAL;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "reindexSearch",
        summary:     "Rebuild/backfill a search index",
        description: "S2S — kicks off a zero-downtime alias-swap rebuild for one type (or all types).",
        tags:        [ "Search" ],
    };

    constructor( body? : PostSearchInternalReindex.Body ) { super( {}, body ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return []; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null
    { return { type: "object", additionalProperties: false, properties: { type: { type: "string", enum: Object.values( Search.DocType ) } } }; }
}

export namespace PostSearchInternalReindex
{
    export const URI : string = apiPath( "search", 1, "/internal/reindex" );
    export interface Body extends RestfulEndpoint.NonAuthRequest { type? : Search.DocType; }
    export interface Response { accepted : boolean; }
    export enum Error { BAD_REQUEST = NetworkUtils.Status.BAD_REQUEST }
}

export default PostSearchInternalReindex;
// eof
