//
import { Application, Consumer, Register, Search, Cache, Kafka } from "@repo/services";

//
// SearchConsumer — the domain base every concrete search ECS worker extends (mirrors
// AnalyticsConsumer / SearchService on the HTTP side). `SearchIndexerConsumer` is a long-running
// `Consumer` (not a Lambda `Job`) — SPECS.md originally framed the indexer as a `Job` triggered
// directly off Kafka (search-7.3/7.5), but the platform's `makeJob` trigger support is `"queue"` /
// `"table"` ONLY — there is no Lambda↔Kafka event-source-mapping anywhere on this platform.
// `Kafka.subscribeEvents` + a long-running ECS `Consumer` is the supported primitive for this shape
// (same precedent as `AnalyticsIngestConsumer`); SPECS.md has been updated to reflect this as the
// actual, decided implementation.
//
export abstract class SearchConsumer extends Consumer
{
    protected pkg : Application.PackageInfo;

    private _search? : Search;
    private _cache?  : Cache;
    private _kafka?  : Kafka;

    ////////////////////////////////////////////////////////////////////////////////////////////
    constructor( qualifier : string )
    {
        // identity = Register.Service.SEARCH (+ qualifier → "search:indexer")
        super( Register.Service.SEARCH, qualifier );
        this.pkg = this.loadPackageInfo( __dirname );
        this.log.info( "version", { name: this.pkg.name, version: this.pkg.version } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    public get search() : Search { return this._search ??= new Search( this.cloud ); }
    public get cache()  : Cache  { return this._cache  ??= new Cache( this.cloud, "cache" ); }
    public get kafka()  : Kafka  { return this._kafka  ??= new Kafka( this.cloud ); }
}

export default SearchConsumer;
// eof
