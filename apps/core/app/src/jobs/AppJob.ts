//
import { Application, Job, Events } from "@repo/services";

//
// common app job base — the domain base every concrete app job extends (mirrors AppService on the
// HTTP side). Holds the shared job domain code as it lands (the ticket-provider factory,
// monitor/analytics emit, idempotency, DLQ handling — see SPECS.md "Service & Job topology").
// Concrete jobs extend THIS, never the framework `Job` directly.
//
export abstract class AppJob<TEvent = unknown, TResult = void> extends Job<TEvent, TResult>
{
    // name/version of this app, read from apps/core/app/package.json at startup
    protected pkg : Application.PackageInfo;

    ///////////////////////////////////////////////////////////////////////////////////////
    constructor( name : string )
    {
        // identity = Events.Service.APP (+ job name → "app:ticket")
        super( Events.Service.APP, name );

        this.pkg = this.loadPackageInfo( __dirname );
        this.log.info( "version", { name: this.pkg.name, version: this.pkg.version } );
    }

    ///////////////////////////////////////////////////////////////////////////////////////
    protected async init() : Promise<void>
    {
        await super.init();
    }
}

export default AppJob;
