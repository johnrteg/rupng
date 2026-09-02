//
import { GetSearchSuggest, Search as SearchModel } from "@repo/api";
import { NetworkUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";

import SearchService from "../services/SearchService";

// a type-ahead dropdown wants a handful of hits, fast — capped well below GetSearch's page size.
const SUGGEST_LIMIT : number = 8;

//
// Type-ahead suggestions (search-2.3, gap #2 — a later enhancement). Same mandatory RBAC filter as
// `GetSearch` (built via the SAME `SearchService.rbacFilter`/`textClause` helpers, so the two
// endpoints' query DSL can't drift apart), a thin/capped variant with no paging/highlighting.
//
export class GetSearchSuggestImpl extends GetSearchSuggest
{
    private service : SearchService;
    constructor( service : SearchService ) { super(); this.service = service; }

    ////////////////////////////////////////////////////////////////////////////////////////////
    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        const filter : Type.Result<Array<Record<string, unknown>>> = this.service.rbacFilter( auth );
        if( !filter.ok ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: filter.error } };

        const q : string = this.query.q;
        let response : unknown;
        try
        {
            response = await this.service.search.client.search( {
                index: SearchService.INDEX,
                body: {
                    query: { bool: { must: [ this.service.textClause( q, false ) ], filter: filter.data } },
                    size: SUGGEST_LIMIT,
                },
            } );
        }
        catch( cause : unknown )
        {
            this.service.log.error( "suggest: OpenSearch query failed", { error: String( cause ) } );
            return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { hits: [] } };
        }

        const body : { hits? : { hits?: Array<{ _source?: SearchModel.IndexDoc; _score?: number }> } } = ( response as { body : unknown } ).body as never;
        const hits : Array<SearchModel.Hit> = ( body.hits?.hits ?? [] )
            .filter( ( hit ) : boolean => hit._source !== undefined )
            .map( ( hit ) : SearchModel.Hit => ( { doc: hit._source as SearchModel.IndexDoc, score: hit._score ?? 0 } ) );

        return { status: NetworkUtils.Status.OK, data: { hits } };
    }
}

export default GetSearchSuggestImpl;
// eof
