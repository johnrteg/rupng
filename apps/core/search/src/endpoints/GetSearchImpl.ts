//
import { GetSearch, Search as SearchModel, SearchConfig } from "@repo/api";
import { Cache } from "@repo/services";
import { NetworkUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";

import SearchService from "../services/SearchService";

// hard paging caps — a client-supplied page/pageSize can never grow the OpenSearch read past this,
// independent of whatever SearchConfig.Config later adds for per-account tuning.
const DEFAULT_PAGE_SIZE : number = 20;
const MAX_PAGE_SIZE     : number = 100;

//
// Global content search (search-2.1) — Redis-first (search-2.2), falling back to OpenSearch on a
// miss with the mandatory RBAC filter (search-3.1/3.2/3.3, built ONCE by `SearchService.rbacFilter`)
// ANDed onto the caller's text query + optional `type`/`from`/`to` filters. Cached under a key that
// includes account + role (search-3.3/gap #6's cache-safety requirement — a switch/logout can never
// serve another context's cached results because the key itself changes).
//
export class GetSearchImpl extends GetSearch
{
    private service : SearchService;
    constructor( service : SearchService ) { super(); this.service = service; }

    ////////////////////////////////////////////////////////////////////////////////////////////
    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        const filter : Type.Result<Array<Record<string, unknown>>> = this.service.rbacFilter( auth );
        if( !filter.ok ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: filter.error } };

        const query : GetSearch.Query = this.query;
        const page     : number = Math.max( 1, query.page ?? 1 );
        const pageSize : number = Math.min( MAX_PAGE_SIZE, Math.max( 1, query.pageSize ?? DEFAULT_PAGE_SIZE ) );

        // Redis-first — a hit is refreshed (touched) rather than just returned, per search-2.2
        const cacheKey : Cache.KeyParts = {
            purpose: Cache.Purpose.CACHE, entity: "query",
            id: GetSearchImpl.cacheId( query, auth.accountId!, auth.role! ),
        };
        const cached : Type.Result<GetSearch.Response | null> = await this.service.cache.get<GetSearch.Response>( cacheKey );
        if( cached.ok && cached.data !== null )
        {
            const config : SearchConfig.Config = await this.service.searchConfig();
            // GetSearch.Response is a named interface — not structurally a Type.Json (no index
            // signature); cast at this storage boundary per Types.ts's documented JSON caveat.
            await this.service.cache.set( cacheKey, cached.data as unknown as Type.Json, config.cacheTtlSeconds );   // refresh TTL on hit
            return { status: NetworkUtils.Status.OK, data: cached.data };
        }

        const built : { must : Array<Record<string, unknown>>; filter : Array<Record<string, unknown>> } = {
            must:   [ this.service.textClause( query.q, query.exact === true ) ],
            filter: [ ...filter.data ],
        };
        if( query.type ) built.filter.push( { term: { type: query.type } } );
        if( query.from || query.to )
        {
            const range : Record<string, string> = {};
            if( query.from ) range.gte = query.from;
            if( query.to )   range.lte = query.to;
            built.filter.push( { range: { updatedAt: range } } );
        }

        // NOT the wrapped `Search.search()` (flat match only, no paging/highlighting) — reach `.client`
        // directly for `from`/`size` + a `highlight` block (search-2.4). See SearchService.textClause's
        // header comment for the documented gap: no index-mapping/analyzer creation step exists yet.
        let response : unknown;
        try
        {
            response = await this.service.search.client.search( {
                index: SearchService.INDEX,
                body: {
                    query: { bool: built },
                    from: ( page - 1 ) * pageSize,
                    size: pageSize,
                    highlight: { fields: { title: {}, text: {} } },
                },
            } );
        }
        catch( cause : unknown )
        {
            this.service.log.error( "search: OpenSearch query failed", { error: String( cause ) } );
            return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "search failed" } };
        }

        const result : GetSearch.Response = GetSearchImpl.toResult( response, page, pageSize );
        const config : SearchConfig.Config = await this.service.searchConfig();
        const wrote : Type.Result<void> = await this.service.cache.set( cacheKey, result as unknown as Type.Json, config.cacheTtlSeconds );
        if( !wrote.ok ) this.service.log.warn( "search: result-cache write failed (non-fatal)", { error: wrote.error } );

        return { status: NetworkUtils.Status.OK, data: result };
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** Map an OpenSearch response body into the wire `Search.Result` shape (search-2.1). */
    private static toResult( response : unknown, page : number, pageSize : number ) : GetSearch.Response
    {
        const body : { hits? : { total? : { value? : number }; hits?: Array<{ _source?: SearchModel.IndexDoc; _score?: number; highlight?: Record<string, Array<string>> }> } } =
            ( response as { body : unknown } ).body as never;
        const rawHits : Array<{ _source?: SearchModel.IndexDoc; _score?: number; highlight?: Record<string, Array<string>> }> = body.hits?.hits ?? [];

        const hits : Array<SearchModel.Hit> = rawHits
            .filter( ( hit ) : boolean => hit._source !== undefined )
            .map( ( hit ) : SearchModel.Hit => ( {
                doc:       hit._source as SearchModel.IndexDoc,
                score:     hit._score ?? 0,
                highlight: ( hit.highlight?.title ?? hit.highlight?.text )?.[ 0 ],
            } ) );

        return { hits, total: body.hits?.total?.value ?? 0, page, pageSize };
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** The Redis cache key's `<id>` segment (search-2.2/3.3): `query + account + role + filters`, so a
     *  role change or account switch is a DIFFERENT key — never a stale-authz serve. */
    private static cacheId( query : GetSearch.Query, accountId : string, role : string ) : string
    {
        return [ query.q, accountId, role, query.type ?? "-", query.from ?? "-", query.to ?? "-",
                 query.exact ? "exact" : "fuzzy", query.page ?? 1, query.pageSize ?? DEFAULT_PAGE_SIZE ].join( "|" );
    }
}

export default GetSearchImpl;
// eof
