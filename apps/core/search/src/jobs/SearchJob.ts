//
import { Application, Job, Register, Search } from "@repo/services";

//
// SearchJob — the domain base every concrete search Lambda job extends (mirrors SearchService /
// SearchConsumer). Holds the shared domain wiring (the OpenSearch facade) for the operator-triggered,
// one-shot job (`SearchReindexJob` today — search-1.4/7.4). Distinct from `SearchConsumer`: that's the
// long-running Kafka firehose reader; this is an invoke-work-exit Lambda triggered by a queue.
//
export abstract class SearchJob<TEvent = unknown, TResult = void> extends Job<TEvent, TResult>
{
    protected pkg : Application.PackageInfo;

    private _search? : Search;

    ////////////////////////////////////////////////////////////////////////////////////////////
    constructor( name : string )
    {
        super( Register.Service.SEARCH, name );
        this.pkg = this.loadPackageInfo( __dirname );
        this.log.info( "version", { name: this.pkg.name, version: this.pkg.version } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    public get search() : Search { return this._search ??= new Search( this.cloud ); }
}

export default SearchJob;
// eof
