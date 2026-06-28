import { EventEmitter } from "node:events";
import { existsSync, readFileSync, readdirSync, statSync, watch, type FSWatcher } from "node:fs";
import { join } from "node:path";

import { STAGE_ORDER, autoSteps, type BuildSettings, type BuildQueue, type StageId } from "../shared/types";
import { APPS_CORE, CLOUD_DIR, REPO_ROOT, serviceDir } from "./paths";
import { processManager } from "./processManager";
import { recordDeploy } from "./deployState";
import { getService } from "./registry";
import { syncSiteOnce } from "./webDev";
import { reloadBrowser } from "./browser";

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
    private order    : string[] = [];
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
        this.settings = settings;
        this.rewire();
        if ( this.configured )
            for ( const svc of this.autoSet() ) if ( !wasAuto.has( svc ) ) this.enqueue( svc, this.serviceSteps( svc ) );
        this.configured = true;
    }

    queueState() : BuildQueue { return { queue: [ ...this.order ], current: this.current, done: this.done, total: this.total }; }

    /** Re-read the dependency graph + re-wire watchers — call after services/packages or @repo deps
     *  change (the graph is cached, so a new service/package or edited dep needs this to take effect). */
    rescan() : void { this.graph = undefined; this.rewire(); }

    /** Run a single step once (the per-step ▶ in the toolbar — for steps that are off but enabled). */
    runStepNow( service : string, step : StageId ) : void { this.enqueue( service, [ step ] ); }

    /** Run this service's currently auto-on steps once, now (the toolbar's "Run now"). */
    runNow( service : string ) : void { this.enqueue( service, this.serviceSteps( service ) ); }

    // ── settings helpers ───────────────────────────────────────────────────────────────────────────
    private isFrontend( service : string ) : boolean { return getService( service )?.capabilities.isFrontend ?? false; }

    /** The auto-on steps for a service, honouring the build→docker→deploy cascade + deployability. */
    private serviceSteps( service : string ) : StageId[]
    {
        const s : BuildSettings | undefined = this.settings[ service ];
        const caps = getService( service )?.capabilities;
        return s ? autoSteps( s, caps?.isFrontend ?? false, caps?.canDeploy ?? false ) : [];
    }

    /** Services that watch for changes (auto-Build on). */
    private autoSet() : Set<string> { return new Set( Object.entries( this.settings ).filter( ( [ , s ] ) => s.build ).map( ( [ svc ] ) => svc ) ); }

    // ── dependency graph ─────────────────────────────────────────────────────────────────────────
    private depGraph() : DepGraph
    {
        if ( this.graph ) return this.graph;

        const repoDeps = ( dir : string ) : string[] =>
        {
            try
            {
                const p = JSON.parse( readFileSync( join( dir, "package.json" ), "utf8" ) ) as { dependencies? : Record<string, string>; devDependencies? : Record<string, string> };
                return [ ...Object.keys( p.dependencies ?? {} ), ...Object.keys( p.devDependencies ?? {} ) ].filter( ( n ) => n.startsWith( "@repo/" ) );
            }
            catch { return []; }
        };
        const pkgName = ( dir : string ) : string | undefined =>
        {
            try { return ( JSON.parse( readFileSync( join( dir, "package.json" ), "utf8" ) ) as { name? : string } ).name; }
            catch { return undefined; }
        };

        // package name → its own @repo deps + dir
        const pkgDir : Map<string, string> = new Map();          // "@repo/x" → packages/x
        const pkgDeps : Map<string, string[]> = new Map();       // "@repo/x" → ["@repo/y", …]
        const pkgDirToName : Map<string, string> = new Map();
        for ( const dir of safeDirs( join( REPO_ROOT, "packages" ) ) )
        {
            const name : string | undefined = pkgName( dir );
            if ( !name ) continue;
            pkgDir.set( name, dir ); pkgDirToName.set( dir, name ); pkgDeps.set( name, repoDeps( dir ) );
        }

        // transitive closure of a package's @repo deps
        const closure = ( start : string[] ) : Set<string> =>
        {
            const seen = new Set<string>(); const stack = [ ...start ];
            while ( stack.length )
            {
                const n = stack.pop()!;
                if ( seen.has( n ) ) continue;
                seen.add( n );
                for ( const d of pkgDeps.get( n ) ?? [] ) stack.push( d );
            }
            return seen;
        };

        // service → transitive @repo packages → reverse into pkg → services
        const pkgToServices : Map<string, Set<string>> = new Map();
        for ( const grp of safeDirs( APPS_CORE ) )   // APPS_CORE is apps/core; services are its children
        {
            const svc : string = grp.split( "/" ).pop() ?? "";   // grp is apps/core/<svc>
            if ( !svc ) continue;
            for ( const used of closure( repoDeps( grp ) ) )
            {
                const set = pkgToServices.get( used ) ?? new Set<string>();
                set.add( svc ); pkgToServices.set( used, set );
            }
        }

        this.graph = { pkgDirToName, pkgToServices };
        return this.graph;
    }

    // ── watchers ─────────────────────────────────────────────────────────────────────────────────
    private rewire() : void
    {
        for ( const [ , w ] of this.watchers ) { try { w.close(); } catch { /* */ } }
        this.watchers.clear();

        const auto : Set<string> = this.autoSet();
        if ( auto.size === 0 ) return;
        const g : DepGraph = this.depGraph();

        // 1) each auto-build service's own src → run that service's chain
        for ( const svc of auto )
        {
            const src : string = join( serviceDir( svc ), "src" );
            if ( existsSync( src ) ) this.watchDir( src, () => this.enqueue( svc, this.serviceSteps( svc ) ) );
        }

        // 2) each shared package src → run the chain for the auto-build services that depend on it
        for ( const [ dir, name ] of g.pkgDirToName )
        {
            const dependents : string[] = [ ...( g.pkgToServices.get( name ) ?? [] ) ].filter( ( s ) => auto.has( s ) );
            if ( dependents.length === 0 ) continue;
            const src : string = join( dir, "src" );
            if ( existsSync( src ) ) this.watchDir( src, () => { for ( const s of dependents ) this.enqueue( s, this.serviceSteps( s ) ); } );
        }
    }

    private watchDir( dir : string, onChange : () => void ) : void
    {
        if ( this.watchers.has( dir ) ) return;
        try
        {
            const watcher : FSWatcher = watch( dir, { recursive: true }, () =>
            {
                const t = this.timers.get( dir );
                if ( t ) clearTimeout( t );
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
    buildAll( ids : string[], runId? : string ) : void
    {
        for ( const id of ids )
        {
            if ( !( getService( id )?.capabilities.canBuild ) ) continue;
            this.enqueue( id, [ "build" ], id === runId );   // only the designated one auto-runs after build
        }
    }

    // ── sequential queue ───────────────────────────────────────────────────────────────────────────
    private enqueue( service : string, steps : StageId[], run : boolean = true ) : void
    {
        if ( steps.length === 0 ) return;
        const job = this.pending.get( service ) ?? { steps: new Set<StageId>(), run: false };
        for ( const s of steps ) job.steps.add( s );
        job.run = job.run || run;   // if any enqueue wants the local run, keep it
        this.pending.set( service, job );
        if ( !this.order.includes( service ) && this.current !== service ) { this.order.push( service ); this.total += 1; }
        this.emitQueue();
        if ( !this.draining ) void this.drain();
    }

    private async drain() : Promise<void>
    {
        this.draining = true;
        while ( this.order.length > 0 )
        {
            const svc : string = this.order.shift()!;
            const job = this.pending.get( svc ) ?? { steps: new Set<StageId>(), run: true };
            this.pending.delete( svc );
            this.current = svc;
            this.emitQueue();

            await this.runService( svc, job.steps, job.run );

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

    private emitQueue() : void { this.emit( "queue", this.queueState() ); }
}

function safeDirs( parent : string ) : string[]
{
    if ( !existsSync( parent ) ) return [];
    try { return readdirSync( parent ).map( ( n ) => join( parent, n ) ).filter( ( p ) => statSync( p ).isDirectory() ); }
    catch { return []; }
}

export const buildOrchestrator = new BuildOrchestrator();
