//
import { Application, Job, Register, Dynamo, Kafka } from "@repo/services";

import { HealthPipeline } from "../pipeline/HealthPipeline";

//
// common marketplace job base — the domain base every concrete marketplace Job extends (mirrors
// MarketplaceService on the HTTP side). Holds the facades + the shared HealthPipeline deps.
// Concrete jobs extend THIS.
//
export abstract class MarketplaceJob<TEvent = unknown, TResult = void> extends Job<TEvent, TResult>
{
    protected pkg : Application.PackageInfo;

    private _dynamo? : Dynamo;
    private _kafka?  : Kafka;

    ///////////////////////////////////////////////////////////////////////////////////////
    constructor( name : string )
    {
        super( Register.Service.MARKETPLACE, name );
        this.pkg = this.loadPackageInfo( __dirname );
        this.log.info( "version", { name: this.pkg.name, version: this.pkg.version } );
    }

    ///////////////////////////////////////////////////////////////////////////////////////
    protected get dynamo() : Dynamo { return this._dynamo ??= new Dynamo( this.cloud ); }

    /** Kafka facade — CRUD/trigger event emission (marketplace.* topics), best-effort. Lazy + cached. */
    protected get kafka() : Kafka { return this._kafka ??= new Kafka( this.cloud ); }

    /** The facades the shared `HealthPipeline` needs. */
    protected pipelineDeps() : HealthPipeline.Deps { return { dynamo: this.dynamo, log: this.log }; }
}

export default MarketplaceJob;
