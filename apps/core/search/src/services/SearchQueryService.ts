//
import SearchService from "./SearchService";
import GetSearchImpl from "../endpoints/GetSearchImpl";
import GetSearchSuggestImpl from "../endpoints/GetSearchSuggestImpl";
import PostSearchInternalReindexImpl from "../endpoints/PostSearchInternalReindexImpl";
import GetSearchConfigImpl from "../endpoints/GetSearchConfigImpl";
import PutSearchConfigImpl from "../endpoints/PutSearchConfigImpl";

//
// SearchQueryService — search's ONE HTTP role (SPECS.md "Service & Job topology"): the RBAC-scoped
// query API (`GET /search`, `GET /search/suggest`), the S2S reindex trigger, and the ops config
// endpoints. The indexer (`SearchIndexerConsumer`) is a SEPARATE, headless ECS `Consumer` role — see
// `src/index.ts` — not part of this HTTP surface.
//
export class SearchQueryService extends SearchService
{
    ////////////////////////////////////////////////////////////////////////////////////////////
    constructor()
    {
        super( SearchService.Role.MAIN );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    protected override async registerEndpoints() : Promise<void>
    {
        await super.registerEndpoints();   // keeps /health + /version
        this.register( new GetSearchImpl( this ) );
        this.register( new GetSearchSuggestImpl( this ) );
        this.register( new PostSearchInternalReindexImpl( this ) );
        this.register( new GetSearchConfigImpl( this ) );
        this.register( new PutSearchConfigImpl( this ) );
    }
}

export default SearchQueryService;
// eof
