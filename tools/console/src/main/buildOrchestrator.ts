import { EventEmitter } from "node:events";
import { existsSync, readFileSync, readdirSync, statSync, watch, type FSWatcher } from "node:fs";
import { join } from "node:path";

import { STAGE_ORDER, autoSteps, type BuildSettings, type BuildQueue, type StageId } from "../shared/types";
import { APPS_CORE, CLOUD_DIR, REPO_ROOT, serviceDir } from "./paths";
import { processManager } from "./processManager";
import { recordDeploy } from "./deployState";
import { getService, listServices } from "./registry";
import { syncSiteOnce } from "./webDev";
import { reloadBrowser } from "./browser";
import { logStore } from "./logStore";

//
// Build orchestrator. Driven by the renderer's per-service "Auto:" settings (build/docker/deploy), it
// watches each auto-Build service's `src/` AND the `src/` of every shared package it depends on
// (dependency-aware). On a change it enqueues the affected service(s) and runs their auto-on steps
// IN ORDER — build → docker image → deploy — ONE SERVICE AT A TIME (a sequential queue, so the
// progress bar + per-button lights stay legible). The chain HALTS on the first failed step.
//   • build  → turbo (processManager.runBuildStage)
//   • image  → docker build (processManager.runImageStage; backends only)
//   • deploy → frontend: sync bin → the LocalStack bucket + refresh the app window; backend: cdklocal
// Each step drives its own processManager STAGE status (the dots); queue progress is its own event.
//

interface DepGraph
{
    pkgDirToName : Map<string, string>;          // packages/<x> dir → "@repo/<x>"
    pkgToServices : Map<string, Set<string>>;    // "@repo/<x>" → services that transitively use it
}

class BuildOrchestrator extends EventEmitter
{
    private settings : Record<string, BuildSettings> = {};
    private watchers  : Map<string, FSWatcher> = new Map();   // watched dir → watcher
    private timers    : Map<string, NodeJS.Timeout> = new Map();
    private graph?    : DepGraph;

    // sequential job queue: one pending job per service, processed in `order`. `run` = auto-(re)start the
    // local process after a successful build (false for a bulk "Build all" so it doesn't spawn the fleet).
    private pending  : Map<string, { steps : Set<StageId>; run : boolean }> = new Map();
    private order    : Array<string> = [];
    private current  : string | null = null;
    private done     : number = 0;
    private total    : number = 0;
    private draining : boolean = false;

    private configured : boolean = false;

    // ── public API ─────────────────────────────────────────────────────────────────────────────
    /** Apply the latest per-service settings: (re)wire watchers + run the chain for services whose
     *  auto-Build was just switched ON. The FIRST call (console startup) only wires watchers — it does
     *  NOT mass-build+run the whole fleet, which would spawn a process per role for every service at
     *  once and exhaust the main process's file descriptors (EMFILE). Builds/runs then happen on an
     *  actual source change or a manual Run. */
    configure( settings : Record<string, BuildSettings> ) : void
    {
        const wasAuto : Set<string> = this.autoSet();
        const first : boolean = !this.configured;
        this.settings = settings;
        this.rewire();
        if ( this.configured )
            for ( const svc of this.autoSet() ) if ( !wasAuto.has( svc ) ) this.enqueue( svc, this.serviceSteps( svc ) );
        this.configured = true;
        // FIRST call = console startup: build + run the "Run on start" services, in sequence.
        if ( first ) this.autoRunOnStartup();
    }

    /** Console startup: BUILD then run every "Run on start" (autoRun) LOCAL backend service. Each is put
     *  on the sequential queue as a build job with `run` = true, so it compiles first (its own src + any
     *  shared deps) and the post-build hook (afterLocalBuild → ensureLocal) then (re)starts the local
     *  process. The queue serializes them, so they come up one at a time in registry order — no manual
     *  stagger, no FD storm. A service with no build step just starts locally. */
    private autoRunOnStartup() : void
    {
        const services : Array<string> = listServices()
            .filter( ( info ) => !info.capabilities.isFrontend )
            .map( ( info ) => info.id )
            .filter( ( id ) => this.settings[ id ]?.autoRun && this.settings[ id ]?.target === "local" );
        if ( services.length === 0 ) return;

        logStore.sys( services[ 0 ], "runtime", `▶ auto-run on startup — build + run ${services.length} service(s) in sequence: ${services.join( ", " )}` );
        for ( const service of services )
        {
            logStore.sys( service, "runtime", "▶ auto-run on startup" );
            if ( getService( service )?.capabilities.canBuild )
                this.enqueue( service, [ "build" ], true );   // build → afterLocalBuild (re)starts it locally
            else
                void processManager.startLocal( service );     // nothing to build — just run it
        }
    }

    /** A snapshot of the sequential queue (pending order, in-flight service, progress counters). */
    queueState() : BuildQueue { return { queue: [ ...this.order ], current: this.current, done: this.done, total: this.total }; }

    /** Re-read the dependency graph + re-wire watchers — call after services/packages or @repo deps
     *  change (the graph is cached, so a new service/package or edited dep needs this to take effect). */
    rescan() : void { this.graph = undefined; this.rewire(); }

    /** Run a single step once (the per-step ▶ in the toolbar — for steps that are off but enabled). */
    runStepNow( service : string, step : StageId ) : void { this.enqueue( service, [ step ] ); }

    /** Run this service's currently auto-on steps once, now (the toolbar's "Run now"). */
    runNow( service : string ) : void { this.enqueue( service, this.serviceSteps( service ) ); }

    // ── settings helpers ───────────────────────────────────────────────────────────────────────────
    /** Whether the service is a frontend (deploys via S3 sync rather than cdklocal). */
    private isFrontend( service : string ) : boolean { return getService( service )?.capabilities.isFrontend ?? false; }

    /** The auto-on steps for a service, honouring the build→docker→deploy cascade + deployability. */
    private serviceSteps( service : string ) : Array<StageId>
    {
        const settings : BuildSettings | undefined = this.settings[ service ];
        const caps = getService( service )?.capabilities;
        return settings ? autoSteps( settings, caps?.isFrontend ?? false, caps?.canDeploy ?? false ) : [];
    }

    /** Services that watch for changes (auto-Build on). */
    private autoSet() : Set<string> { return new Set( Object.entries( this.settings ).filter( ( [ , settings ] ) => settings.build ).map( ( [ service ] ) => service ) ); }

    // ── dependency graph ─────────────────────────────────────────────────────────────────────────
    /** Build (and cache) the package→services graph so a shared-package edit can re-trigger every
     *  service that transitively depends on it. */
    private depGraph() : DepGraph
    {
        if ( this.graph ) return this.graph;

        // the @repo/* dependencies (prod + dev) declared by the package.json in `dir`
        const repoDeps = ( dir : string ) : Array<string> =>
        {
            try
            {
                const pkg = JSON.parse( readFileSync( join( dir, "package.json" ), "utf8" ) ) as { dependencies? : Record<string, string>; devDependencies? : Record<string, string> };
                return [ ...Object.keys( pkg.dependencies ?? {} ), ...Object.keys( pkg.devDependencies ?? {} ) ].filter( ( name ) => name.startsWith( "@repo/" ) );
            }
            catch { return []; }
        };
        // the declared name of the package in `dir`
        const pkgName = ( dir : string ) : string | undefined =>
        {
            try { return ( JSON.parse( readFileSync( join( dir, "package.json" ), "utf8" ) ) as { name? : string } ).name; }
            catch { return undefined; }
        };

        // package name → its own @repo deps + dir
        const pkgDir : Map<string, string> = new Map();          // "@repo/x" → packages/x
        const pkgDeps : Map<string, Array<string>> = new Map();       // "@repo/x" → ["@repo/y", …]
        const pkgDirToName : Map<string, string> = new Map();
        for ( const dir of safeDirs( join( REPO_ROOT, "packages" ) ) )
        {
            const name : string | undefined = pkgName( dir );
            if ( !name ) continue;
            pkgDir.set( name, dir ); pkgDirToName.set( dir, name ); pkgDeps.set( name, repoDeps( dir ) );
        }

        // transitive closure of a package's @repo deps (iterative DFS over the pkgDeps graph)
        const closure = ( start : Array<string> ) : Set<string> =>
        {
            const seen = new Set<string>(); const stack = [ ...start ];
            while ( stack.length )
            {
                const pkg = stack.pop()!;
                if ( seen.has( pkg ) ) continue;
                seen.add( pkg );
                for ( const dep of pkgDeps.get( pkg ) ?? [] ) stack.push( dep );
            }
            return seen;
        };

        // service → transitive @repo packages → reverse into pkg → services
        const pkgToServices : Map<string, Set<string>> = new Map();
        for ( const serviceGroupDir of safeDirs( APPS_CORE ) )   // APPS_CORE is apps/core; services are its children
        {
            const service : string = serviceGroupDir.split( "/" ).pop() ?? "";   // serviceGroupDir is apps/core/<svc>
            if ( !service ) continue;
            for ( const usedPackage of closure( repoDeps( serviceGroupDir ) ) )
            {
                const dependents = pkgToServices.get( usedPackage ) ?? new Set<string>();
                dependents.add( service ); pkgToServices.set( usedPackage, dependents );
            }
        }

        this.graph = { pkgDirToName, pkgToServices };
        return this.graph;
    }

    // ── watchers ─────────────────────────────────────────────────────────────────────────────────
    /** Tear down every existing watcher and re-create one per auto-build service src + per shared
     *  package src that an auto-build service depends on (dependency-aware change detection). */
    private rewire() : void
    {
        for ( const [ , watcher ] of this.watchers ) { try { watcher.close(); } catch { /* */ } }
        this.watchers.clear();

        const auto : Set<string> = this.autoSet();
        if ( auto.size === 0 ) return;
        const graph : DepGraph = this.depGraph();

        // 1) each auto-build service's own src → run that service's chain
        for ( const service of auto )
        {
            const src : string = join( serviceDir( service ), "src" );
            if ( existsSync( src ) ) this.watchDir( src, () => this.enqueue( service, this.serviceSteps( service ) ) );
        }

        // 2) each shared package src → run the chain for the auto-build services that depend on it
        for ( const [ dir, name ] of graph.pkgDirToName )
        {
            const dependents : Array<string> = [ ...( graph.pkgToServices.get( name ) ?? [] ) ].filter( ( service ) => auto.has( service ) );
            if ( dependents.length === 0 ) continue;
            const src : string = join( dir, "src" );
            if ( existsSync( src ) ) this.watchDir( src, () => { for ( const service of dependents ) this.enqueue( service, this.serviceSteps( service ) ); } );
        }
    }

    /** Recursively watch `dir`, firing `onChange` debounced 500ms after the last change. Idempotent
     *  (one watcher per dir) and resilient — a watcher error self-closes rather than crashing main. */
    private watchDir( dir : string, onChange : () => void ) : void
    {
        if ( this.watchers.has( dir ) ) return;
        try
        {
            const watcher : FSWatcher = watch( dir, { recursive: true }, () =>
            {
                const pending = this.timers.get( dir );
                if ( pending ) clearTimeout( pending );
                this.timers.set( dir, setTimeout( onChange, 500 ) );   // debounce save bursts
            } );
            // a watcher error (e.g. EMFILE: too many open files) must NOT bubble to an uncaught exception
            watcher.on( "error", ( err ) => { try { watcher.close(); } catch { /* */ } this.watchers.delete( dir ); void err; } );
            this.watchers.set( dir, watcher );
        }
        catch { /* couldn't create the watcher (EMFILE / gone) — skip; a manual Run/Rescan still works */ }
    }

    /** Build every build-capable service sequentially (the queue serializes them, so no FD storm / races),
     *  WITHOUT auto-running the fleet. Only `runId` (the designated service) is started locally — after
     *  its own build — so you get everything compiled but a single running process. */
    buildAll( ids : Array<string>, runId? : string ) : void
    {
        for ( const id of ids )
        {
            if ( !( getService( id )?.capabilities.canBuild ) ) continue;
            this.enqueue( id, [ "build" ], id === runId );   // only the designated one auto-runs after build
        }
    }

    // ── sequential queue ───────────────────────────────────────────────────────────────────────────
    /** Merge the requested steps into the service's pending job (coalescing repeat triggers), append it
     *  to the queue if not already there/in-flight, and kick the drain loop if it's idle. */
    private enqueue( service : string, steps : Array<StageId>, run : boolean = true ) : void
    {
        if ( steps.length === 0 ) return;
        const job = this.pending.get( service ) ?? { steps: new Set<StageId>(), run: false };
        for ( const step of steps ) job.steps.add( step );
        job.run = job.run || run;   // if any enqueue wants the local run, keep it
        this.pending.set( service, job );
        if ( !this.order.includes( service ) && this.current !== service ) { this.order.push( service ); this.total += 1; }
        this.emitQueue();
        if ( !this.draining ) void this.drain();
    }

    /** Process the queue one service at a time until empty, emitting progress as it goes, then reset
     *  the counters. Only ever one instance runs at once (guarded by `draining`). */
    private async drain() : Promise<void>
    {
        this.draining = true;
        while ( this.order.length > 0 )
        {
            const service : string = this.order.shift()!;
            const job = this.pending.get( service ) ?? { steps: new Set<StageId>(), run: true };
            this.pending.delete( service );
            this.current = service;
            this.emitQueue();

            await this.runService( service, job.steps, job.run );

            this.done += 1;
            this.current = null;
            this.emitQueue();
        }
        // run complete — reset counters
        this.done = 0; this.total = 0;
        this.draining = false;
        this.emitQueue();
    }

    /** Run a service's steps in pipeline order (build → image → deploy), halting on the first failure.
     *  `run` gates the post-build local (re)start — off for bulk builds so the fleet doesn't all spawn. */
    private async runService( service : string, steps : Set<StageId>, run : boolean ) : Promise<void>
    {
        for ( const step of STAGE_ORDER )
        {
            if ( !steps.has( step ) ) continue;
            const ok : boolean = await this.runStep( service, step );
            if ( !ok ) break;   // chain halts — downstream steps don't run on a failure
            if ( step === "build" && run ) this.afterLocalBuild( service );   // auto-(re)start the local process
        }
    }

    /** Run a single pipeline step and return its success. build/image delegate to the process manager;
     *  deploy is handled here (frontend S3 sync vs backend cdklocal) and drives its own stage dot. */
    private async runStep( service : string, step : StageId ) : Promise<boolean>
    {
        if ( step === "build" ) return processManager.runBuildStage( service );
        if ( step === "image" ) return processManager.runImageStage( service );

        // deploy — owned here (frontend sync vs backend cdklocal), with the deploy dot driven from the result
        const frontend : boolean = this.isFrontend( service );
        processManager.setStageStatus( service, "deploy", "running" );
        let ok : boolean;
        if ( frontend )
        {
            ok = ( await syncSiteOnce( service ) ).ok;
        }
        else
        {
            ok = ( await processManager.exec( service, "deploy", "npx",
                [ "cdklocal", "deploy", `*${service}*`, "-c", "env=local", "--require-approval", "never" ], CLOUD_DIR ) ) === 0;
        }
        processManager.setStageStatus( service, "deploy", ok ? "success" : "failed" );
        if ( ok ) recordDeploy( service );        // remember the manifest hash now deployed (→ drift detection)
        if ( ok && frontend ) reloadBrowser();    // show the freshly-deployed build in the app window
        return ok;
    }

    /** After a successful build under the LOCAL target: (re)start the local process so the new code
     *  takes effect (a rebuilt @repo/* dep won't restart `tsx watch` on its own). A frontend "runs" in
     *  the in-app browser, so just refresh it (the webproxy serves the fresh bin). LocalStack target
     *  doesn't run locally — its deploy step handles propagation. */
    private afterLocalBuild( service : string ) : void
    {
        if ( this.settings[ service ]?.target !== "local" ) return;
        if ( this.isFrontend( service ) ) reloadBrowser();   // no-op when the window is closed
        else processManager.ensureLocal( service );          // auto-run: start/restart every role process
    }

    /** Push the current queue snapshot to listeners (→ the renderer's build-progress UI). */
    private emitQueue() : void { this.emit( "queue", this.queueState() ); }
}

/** Immediate subdirectories of `parent` as absolute paths. [] if `parent` is missing/unreadable. */
function safeDirs( parent : string ) : Array<string>
{
    if ( !existsSync( parent ) ) return [];
    try { return readdirSync( parent ).map( ( name ) => join( parent, name ) ).filter( ( path ) => statSync( path ).isDirectory() ); }
    catch { return []; }
}

export const buildOrchestrator = new BuildOrchestrator();
