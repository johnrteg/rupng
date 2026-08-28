//
// Daemon — the long-running, resident base: a process that stays alive (the classic "…d",
// e.g. httpd / sshd). It owns the bits a long-lived process needs and that the `Application`
// base deliberately omits so one-shot `Job`/Lambda contexts never install process-level
// handlers: OS-signal handling, graceful drain, and a fatal-boot lifecycle.
//
// NOT instantiated directly — extend one of its two kinds, which differ only in *how they
// block / get work*:
//   • Service  — request-driven: blocks on a Fastify HTTP listener.
//   • Consumer — self-driven: blocks on a consume / drain run-loop over the Kafka/SQS/stream backbone.
//
// (Hierarchy: Application → Daemon → { Service, Consumer };  Job is the one-shot sibling.
//  See packages/services/README.md "Class hierarchy".)
//

import { Application } from './Application';
import type { Register } from '@repo/system';

export abstract class Daemon extends Application
{
    private shuttingDown : boolean = false;
    private logLevelTimer? : ReturnType<typeof setInterval>;

    // max time to wait for aboutToQuit() before forcing the process to exit
    private static readonly SHUTDOWN_TIMEOUT_MS : number = 10_000;

    // how often a long-running process re-checks its `config/settings` profile's `logLevel` — a one-shot
    // Job already gets a fresh read every invocation (Application.config()); a Daemon stays up, so it needs
    // its own poll to pick up an operator's change WITHOUT waiting for a restart.
    private static readonly LOG_LEVEL_REFRESH_MS : number = 30_000;

    ////////////////////////////////////////////////////////////////////////
    constructor( service : Register.Service, qualifier ? : string )
    {
        super( service, qualifier );
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////////////////
    // bind the signal handler so `this` is stable when the OS fires it (callbacks bind at construction).
    protected bindCallbacks() : void
    {
        super.bindCallbacks();
        this.onSignalShutdown = this.onSignalShutdown.bind( this );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    // a long-running process owns its lifecycle, so it listens for OS shutdown signals
    protected async init() : Promise<void>
    {
        await super.init();
        this.registerSignals();
        this.startLogLevelRefresh();
    }

    ////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    // poll for a live `logLevel` change on an interval — `.unref()` so the timer never keeps the process alive
    // on its own (shutdown still proceeds on SIGINT/SIGTERM with nothing else pending).
    private startLogLevelRefresh() : void
    {
        this.logLevelTimer = setInterval( () => { void this.refreshLogLevel(); }, Daemon.LOG_LEVEL_REFRESH_MS );
        this.logLevelTimer.unref();
    }

    ////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    private registerSignals() : void
    {
        process.on( 'SIGINT',  this.onSignalShutdown );
        process.on( 'SIGTERM', this.onSignalShutdown );
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////////////////
    private onSignalShutdown() : void
    {
        // ignore repeated signals (e.g. double Ctrl-C) so shutdown only runs once
        if( this.shuttingDown )
        {
            this.log.warn('Daemon::onSignalShutdown ignored - shutdown already in progress');
            return;
        }
        this.shuttingDown = true;

        this.log.info('Daemon::onSignalShutdown (SIGINT or SIGTERM)');

        // safety net: if aboutToQuit() hangs, force the process to exit
        const force = setTimeout( () => {
            this.log.error('Daemon::onSignalShutdown timed out - forcing exit');
            process.exit( 1 );
        }, Daemon.SHUTDOWN_TIMEOUT_MS );
        force.unref();

        this.doShutdown();
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////////////////
    private async doShutdown() : Promise<void>
    {
        try
        {
            await this.aboutToQuit();
            this.stop( 0 );
        }
        catch( err : any )
        {
            this.log.error("Error during shutdown", err );
            this.stop( 1 );
        }
    }

    /////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    protected stop( code : number ) : void
    {
        this.log.info( "Daemon shutting down", { code: code } );
        process.exit( code );
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////////////////
    // true once a shutdown signal has been received — long-running kinds (esp. Consumer) check this to
    // stop pulling new work and drain in-flight gracefully.
    protected isShuttingDown() : boolean
    {
        return this.shuttingDown;
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////////////////
    // A long-running process cannot continue without a successful boot, so a failed run()
    // is fatal: log and exit non-zero. (process.exit lives here, not in Application.)
    public async run() : Promise<void>
    {
        try
        {
            await super.run();
        }
        catch( err : any )
        {
            this.log.error( "Daemon::run boot failed - exiting", { code: 1 } );
            process.exit( 1 );
        }
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////////////////
    // allow inherited daemons to perform clean up on exit (close connections, flush, drain in-flight work),
    // called before process.exit. Override and call super.aboutToQuit().
    protected async aboutToQuit() : Promise<void>
    {
        await super.aboutToQuit();
        if( this.logLevelTimer ) clearInterval( this.logLevelTimer );
    }
}

export default Daemon;
