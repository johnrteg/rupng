import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { delimiter, join } from "node:path";
import { EventEmitter } from "node:events";
import { createServer } from "node:net";

import {
    STAGE_ORDER, WEBPROXY_ID,
    type DeployTarget, type LogStream, type PipelineRequest, type PipelineResult,
    type ProcState, type ServiceInfo, type ServiceRole, type StageId, type StageState, type StageStatus
} from "../shared/types";
import { getService } from "./registry";
import { killTreesAndWait, reapOrphansOnPorts } from "./processScan";
import { localApiRoutes } from "./apiTester";
import { logStore } from "./logStore";
import { ACTIVE_CONFIG, activeConfigExists, readProxyConfig, writeActiveConfig } from "./proxyConfig";
import { CLOUD_DIR, REPO_ROOT, serviceDir } from "./paths";

//
// Process manager + pipeline runner.
//
// Owns every child process the console spawns, keyed by (service, stream). Streams stdout/stderr to
// the log store, tracks ProcState, and exposes kill. The pipeline runs a selected subset of stages
// (build → image → deploy) IN ORDER, halting on the first failure — and remembers per-stage status
// so a re-run with `resume` skips stages that already passed (no rolling back to the start).
//

/** A child process + the command that produced it, for one (service, stream) slot. */
interface Slot
{
    child : ChildProcess;
    command : string;
    startedAt : number;
}

/** PATH augmented with the usual Homebrew/local bins so docker/node/cdklocal resolve even if the */
/** app was launched from Finder (where the GUI PATH is minimal). */
function childEnv() : NodeJS.ProcessEnv
{
    const extra : Array<string> = [ "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin" ];
    const path  : string = [ process.env.PATH ?? "", ...extra ].filter( Boolean ).join( delimiter );
    return { ...process.env, PATH: path, FORCE_COLOR: "1" };
}

/** /usr/sbin + /bin so `lsof`/`ps` resolve even when the app was launched from Finder (minimal PATH). */
const SYS_ENV : NodeJS.ProcessEnv = { ...process.env, PATH: [ process.env.PATH ?? "", "/usr/sbin", "/usr/bin", "/bin", "/sbin" ].filter( Boolean ).join( ":" ) };

/**
 * If `port` is held by a STALE rup process (a webproxy or a `tsx … src/index.ts` dev server orphaned
 * from a prior session / hard-killed console, where will-quit never fired), SIGKILL it so the console
 * can rebind. Identifies it by command line — it will NOT kill an unrelated process that happens to
 * sit on the port. Returns true if it killed something.
 */
function killStaleOnPort( port : number ) : boolean
{
    try
    {
        const pids : Array<string> = execFileSync( "lsof", [ "-ti", `tcp:${port}` ], { encoding: "utf8", env: SYS_ENV } )
            .split( "\n" ).map( ( line ) => line.trim() ).filter( Boolean );
        let killed : boolean = false;
        for ( const pid of pids )
        {
            let commandLine : string = "";
            try { commandLine = execFileSync( "ps", [ "-o", "command=", "-p", pid ], { encoding: "utf8", env: SYS_ENV } ); } catch { /* already gone */ }
            // only reclaim ports held by our own processes: the webproxy, or a `tsx … src/index.ts` dev server
            const isRup : boolean = /webproxy|proxy@/.test( commandLine ) || ( /tsx/.test( commandLine ) && /src\/index\.ts/.test( commandLine ) );
            if ( isRup ) { try { process.kill( Number( pid ), "SIGKILL" ); killed = true; } catch { /* */ } }
        }
        return killed;
    }
    catch { return false; }
}

/** Name of a Docker container publishing this host port, if any (so a "port in use" message can say
 *  WHAT holds it — e.g. a leftover `docker compose` / LocalStack container — instead of "another process"). */
function dockerContainerOnPort( port : number ) : string | undefined
{
    try
    {
        const psOutput : string = execFileSync( "docker", [ "ps", "--format", "{{.Names}}\t{{.Ports}}" ], { encoding: "utf8", env: childEnv() } );
        for ( const line of psOutput.split( "\n" ) )
        {
            const [ name, ports ] = line.split( "\t" );
            if ( name && ports && new RegExp( `:${port}->` ).test( ports ) ) return name;   // host port == our port
        }
    }
    catch { /* docker not running / not installed */ }
    return undefined;
}

/** Names of running Docker containers whose CONTAINER port is one of `ports` — i.e. the ECS task
 *  containers for a service (LocalStack publishes `0.0.0.0:<random>-><containerPort>`). Used to tail a
 *  LocalStack-deployed service's logs by matching its role ports (8100/8101/…). */
function dockerContainersByContainerPort( ports : Array<number> ) : Array<string>
{
    if ( ports.length === 0 ) return [];
    try
    {
        const psOutput : string = execFileSync( "docker", [ "ps", "--format", "{{.Names}}\t{{.Ports}}" ], { encoding: "utf8", env: childEnv() } );
        const names : Array<string> = [];
        for ( const line of psOutput.split( "\n" ) )
        {
            const [ name, portsStr ] = line.split( "\t" );
            // match when any requested container port appears as the `->NNNN/` target in the port mapping
            if ( name && portsStr && ports.some( ( containerPort ) => new RegExp( `->${containerPort}/` ).test( portsStr ) ) ) names.push( name );
        }
        return names;
    }
    catch { return []; }
}

/** Can we bind this port? (false = already in use). Used to avoid spawning a doomed second proxy. */
function portFree( port : number ) : Promise<boolean>
{
    return new Promise( ( resolve ) =>
    {
        const server = createServer();
        server.once( "error", () => resolve( false ) );
        server.once( "listening", () => server.close( () => resolve( true ) ) );
        server.listen( port, "0.0.0.0" );
    } );
}

//
// Hot-reload watchdog (the "poll" half of listen-and-poll).
//
// `tsx watch` reloads on file change via native fsevents — fast and cheap, but the watcher can go
// silently stale (macOS fsevents commonly stops delivering events after a sleep/wake, or when many
// watcher processes accumulate). We keep that fast native path AND poll as a safety net: each tick we
// read the role's LISTENING pid + the newest source mtime; if a source edit is NOT reflected by a pid
// change within the grace window, the watcher is stale and we restart the role's local process.
//
// Cadence is a safety net, not a hot path — 30s is plenty. Override with RUP_RELOAD_WATCHDOG_POLL_SEC
// (clamped ≥ 5s) if you want it snappier or quieter. Grace is capped at the poll interval (and ≤ 8s),
// and disarming is driven by the listener-pid swap (not grace) — so a healthy reload always disarms on
// the next sample and only a genuinely stale watcher (old pid still listening) ever trips a restart.
const RELOAD_WATCHDOG_POLL_MS  : number = Math.max( 5, Number( process.env.RUP_RELOAD_WATCHDOG_POLL_SEC ) || 30 ) * 1000;
const RELOAD_WATCHDOG_GRACE_MS : number = Math.min( RELOAD_WATCHDOG_POLL_MS, 8000 );   // edit unpicked-up this long ⇒ watcher stale

/** The PID currently LISTENing on `port`, or undefined if nothing is (or lsof is unavailable). The
 *  `tsx watch` reload spawns a NEW child on the same port, so a change here = a successful reload. */
function listeningPid( port : number ) : number | undefined
{
    try
    {
        const out : string = execFileSync( "lsof", [ "-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t" ], { encoding: "utf8", env: SYS_ENV } );
        const first : string | undefined = out.split( "\n" ).map( ( line ) => line.trim() ).filter( Boolean )[ 0 ];
        return first ? Number( first ) : undefined;
    }
    catch { return undefined; }   // lsof exits non-zero when nothing listens
}

/** The newest mtime (ms) across a service's own source files — the signal that the developer edited
 *  something `tsx watch` should have reloaded. Recursive over `src/`; resilient to a missing dir. */
function newestSourceMtime( srcDir : string ) : number
{
    let newest : number = 0;
    try
    {
        const entries : Array<string> = readdirSync( srcDir, { recursive: true } ) as unknown as Array<string>;
        for ( const relativePath of entries )
        {
            if ( !/\.(ts|tsx|js|jsx)$/.test( relativePath ) ) continue;
            try { const mtime : number = statSync( join( srcDir, relativePath ) ).mtimeMs; if ( mtime > newest ) newest = mtime; }
            catch { /* file vanished between readdir and stat */ }
        }
    }
    catch { /* no src dir */ }
    return newest;
}

/** Local wall-clock stamp "YYYY-MM-DD HH:MM:SS" for stage start/end lines. */
function clock( ms : number ) : string
{
    const date : Date = new Date( ms );
    const pad = ( value : number ) : string => String( value ).padStart( 2, "0" );
    return `${date.getFullYear()}-${pad( date.getMonth() + 1 )}-${pad( date.getDate() )} ${pad( date.getHours() )}:${pad( date.getMinutes() )}:${pad( date.getSeconds() )}`;
}

/** Human elapsed time: "450ms", "3.4s", "2m 03s", "1h 02m 03s". */
function duration( ms : number ) : string
{
    if ( ms < 1000 ) return `${ms}ms`;
    const seconds : number = Math.round( ms / 100 ) / 10;            // tenths of a second
    if ( seconds < 60 ) return `${seconds}s`;
    const totalSeconds : number = Math.round( ms / 1000 );
    const hours : number = Math.floor( totalSeconds / 3600 );
    const minutes : number = Math.floor( ( totalSeconds % 3600 ) / 60 );
    const remainderSeconds : number = totalSeconds % 60;
    const pad = ( value : number ) : string => String( value ).padStart( 2, "0" );
    return hours > 0 ? `${hours}h ${pad( minutes )}m ${pad( remainderSeconds )}s` : `${minutes}m ${pad( remainderSeconds )}s`;
}

class ProcessManager extends EventEmitter
{
    private slots : Map<string, Slot> = new Map<string, Slot>();
    private stages : Map<string, StageState> = new Map<string, StageState>();

    /** Compose the Map key for a (service, stream) slot. */
    private slotKey( service : string, stream : LogStream ) : string { return `${service}:${stream}`; }

    // ── stage state ───────────────────────────────────────────────────────────────────────────
    /** The current per-stage status for a service, creating an all-idle record on first access. */
    stageState( service : string ) : StageState
    {
        let state : StageState | undefined = this.stages.get( service );
        if ( !state ) { state = { build: "idle", image: "idle", deploy: "idle" }; this.stages.set( service, state ); }
        return state;
    }

    /** Update one stage's status for a service and emit a `stage` event with a snapshot of all stages. */
    private setStage( service : string, stage : StageId, status : StageStatus ) : void
    {
        const state : StageState = this.stageState( service );
        state[ stage ] = status;
        this.emit( "stage", service, { ...state } );
    }

    /** Snapshot of every known service's stage state (each value copied so callers can't mutate ours). */
    allStageStates() : Record<string, StageState>
    {
        const out : Record<string, StageState> = {};
        for ( const [ service, state ] of this.stages ) out[ service ] = { ...state };
        return out;
    }

    /** Set a service's stage status (running/success/failed) — used by the build orchestrator to drive
     *  the per-stage dots + service-button indicator lights (esp. the deploy step it runs itself). */
    setStageStatus( service : string, stage : StageId, status : StageStatus ) : void { this.setStage( service, stage, status ); }

    /** Run just the Build stage (turbo), driving its dot from the exit code. Returns true on success. */
    async runBuildStage( service : string ) : Promise<boolean>
    {
        this.setStage( service, "build", "running" );
        const command : { cmd : string; args : Array<string>; cwd : string } = this.buildCmd( service );
        const ok : boolean = ( await this.run( service, "build", command.cmd, command.args, command.cwd ) ) === 0;
        this.setStage( service, "build", ok ? "success" : "failed" );
        return ok;
    }

    /** Run just the Docker-image stage, driving its dot from the exit code. Returns true on success. */
    async runImageStage( service : string ) : Promise<boolean>
    {
        this.setStage( service, "image", "running" );
        const command : { cmd : string; args : Array<string>; cwd : string } = this.imageCmd( service );
        const ok : boolean = ( await this.run( service, "image", command.cmd, command.args, command.cwd ) ) === 0;
        this.setStage( service, "image", ok ? "success" : "failed" );
        return ok;
    }

    // ── process state ───────────────────────────────────────────────────────────────────────────
    /** A ProcState for every currently-running (service, stream) slot. */
    procStates() : Array<ProcState>
    {
        const out : Array<ProcState> = [];
        for ( const [ key, slot ] of this.slots )
        {
            const [ service, stream ] = key.split( ":" ) as [ string, LogStream ];
            out.push( {
                service, stream, running: true,
                pid: slot.child.pid, command: slot.command, startedAt: slot.startedAt, exitCode: null
            } );
        }
        return out;
    }

    /** Pids of every process THIS console session spawned (stage slots + local role groups + log tails).
     *  The process monitor expands these to their whole trees to tell owned processes from orphans. */
    ownedPids() : Array<number>
    {
        const pids : Array<number> = [];
        for ( const [ , slot ] of this.slots ) if ( slot.child.pid ) pids.push( slot.child.pid );
        for ( const [ , group ] of this.localGroups ) for ( const child of group.values() ) if ( child.pid ) pids.push( child.pid );
        for ( const [ , procs ] of this.tailers ) for ( const child of procs ) if ( child.pid ) pids.push( child.pid );
        return pids;
    }

    /** Whether a (service, stream) is live — for runtime, true if any local role process is alive. */
    isRunning( service : string, stream : LogStream ) : boolean
    {
        if ( stream === "runtime" && this.liveLocal( service ) > 0 ) return true;   // multi-role local group
        return this.slots.has( this.slotKey( service, stream ) );
    }

    // ── spawning ───────────────────────────────────────────────────────────────────────────────
    /**
     * Spawn `cmd args` in `cwd`, piping output to the (service, stream) log. Resolves with the exit
     * code (0 = success). Rejects only on spawn error. One slot per (service, stream) — a new spawn
     * for an occupied slot kills the previous process first.
     */
    private run( service : string, stream : LogStream, cmd : string, args : Array<string>, cwd : string, env? : NodeJS.ProcessEnv ) : Promise<number>
    {
        const key : string = this.slotKey( service, stream );
        if ( this.slots.has( key ) ) this.kill( service, stream );

        const command : string = [ cmd, ...args ].join( " " );
        const startedAt : number = Date.now();

        logStore.sys( service, stream, `\n$ ${command}   (cwd: ${cwd.replace( REPO_ROOT, "." )})` );
        logStore.sys( service, stream, `▶ started ${clock( startedAt )}` );

        return new Promise<number>( ( resolve, reject ) =>
        {
            let child : ChildProcess;
            try
            {
                child = spawn( cmd, args, { cwd, env: { ...childEnv(), ...env }, shell: false } );
            }
            catch ( err )
            {
                logStore.sys( service, stream, `✖ failed to spawn: ${( err as Error ).message}` );
                reject( err );
                return;
            }

            const slot : Slot = { child, command, startedAt };
            this.slots.set( key, slot );
            this.emitProc( service, stream, true, child.pid, command, null, startedAt );

            child.stdout?.on( "data", ( data : Buffer ) => logStore.append( service, stream, "out", data.toString() ) );
            child.stderr?.on( "data", ( data : Buffer ) => logStore.append( service, stream, "err", data.toString() ) );

            child.on( "error", ( err ) =>
            {
                logStore.sys( service, stream, `✖ ${err.message}` );
            } );

            child.on( "close", ( code, signal ) =>
            {
                this.slots.delete( key );
                const exitCode : number = code ?? ( signal ? 1 : 0 );
                const endedAt  : number = Date.now();
                const summary  : string = signal ? `■ terminated (${signal})` : ( exitCode === 0 ? `✔ done (exit 0)` : `✖ exit ${exitCode}` );
                logStore.sys( service, stream, `${summary} · ended ${clock( endedAt )} · took ${duration( endedAt - startedAt )}` );
                this.emitProc( service, stream, false, undefined, command, exitCode, startedAt, endedAt );
                resolve( exitCode );
            } );
        } );
    }

    /** Build a ProcState from the given fields and emit it on the `proc` event for the UI to consume. */
    private emitProc( service : string, stream : LogStream, running : boolean, pid : number | undefined,
                      command : string, exitCode : number | null, startedAt : number, endedAt? : number ) : void
    {
        const state : ProcState = { service, stream, running, pid, command, exitCode, startedAt, endedAt };
        this.emit( "proc", state );
    }

    /** Kill the process in a (service, stream) slot, if any. */
    kill( service : string, stream : LogStream ) : void
    {
        const slot : Slot | undefined = this.slots.get( this.slotKey( service, stream ) );
        if ( !slot ) return;
        logStore.sys( service, stream, "■ stopping…" );
        try { slot.child.kill( "SIGINT" ); } catch { /* already gone */ }
        // hard stop if it ignores SIGINT
        const child : ChildProcess = slot.child;
        setTimeout( () => { try { if ( !child.killed ) child.kill( "SIGKILL" ); } catch { /* */ } }, 4000 );
    }

    /** Stop every running stream for a service (build/image/deploy/runtime) + its local role processes + log tails. */
    killAll( service : string ) : void
    {
        for ( const stream of [ "build", "image", "deploy", "runtime" ] as Array<LogStream> )
            this.kill( service, stream );
        this.stopLocal( service );
        this.stopTailDeployed( service );
    }

    /** Graceful app-quit teardown: SIGTERM every spawned process's WHOLE TREE (npm → tsx → node, the
     *  proxy, log tails) and AWAIT their exit, SIGKILLing stragglers past the timeout. `child.kill()`
     *  alone only signals the npm parent — its tsx/node children would orphan and keep holding ports —
     *  so we kill by tree. Resolves once everything is down (or the timeout forces it). */
    async shutdownGraceful( timeoutMs : number = 5000 ) : Promise<number>
    {
        if ( this.watchdogTimer ) { clearInterval( this.watchdogTimer ); this.watchdogTimer = undefined; }
        const roots : Array<number> = this.ownedPids();
        const stopped : number = await killTreesAndWait( roots, timeoutMs );
        this.slots.clear();
        this.localGroups.clear();
        this.tailers.clear();
        return stopped;
    }

    /** Kill EVERY managed child immediately — called on app quit so nothing orphans (esp. the proxy
     *  on :9000, which would otherwise still hold the port on the next launch → "address in use"). */
    shutdown() : void
    {
        if ( this.watchdogTimer ) { clearInterval( this.watchdogTimer ); this.watchdogTimer = undefined; }
        for ( const [ key, slot ] of this.slots )
        {
            try { slot.child.kill( "SIGKILL" ); } catch { /* already gone */ }
            this.slots.delete( key );
        }
        for ( const [ , group ] of this.localGroups )
            for ( const child of group.values() ) { try { child.kill( "SIGKILL" ); } catch { /* */ } }
        this.localGroups.clear();
        for ( const [ , procs ] of this.tailers )
            for ( const child of procs ) { try { child.kill( "SIGKILL" ); } catch { /* */ } }
        this.tailers.clear();
    }

    // ── stage command resolution ─────────────────────────────────────────────────────────────────
    /** The turbo command that builds a single service. */
    private buildCmd( service : string ) : { cmd : string; args : Array<string>; cwd : string }
    {
        // path-based turbo filter — robust to package-name ≠ dir-name
        return { cmd: "npx", args: [ "turbo", "run", "build", `--filter=./apps/core/${service}` ], cwd: REPO_ROOT };
    }

    /** The command that builds a service's Docker image — its own `docker:build` script if it has one,
     *  otherwise a generic root-context `docker build`. */
    private imageCmd( service : string ) : { cmd : string; args : Array<string>; cwd : string }
    {
        const dir : string = serviceDir( service );
        // prefer the service's own docker:build script (it knows its context/args); else generic root build
        try
        {
            const pkg : { scripts? : Record<string, string> } = JSON.parse( readFileSync( join( dir, "package.json" ), "utf8" ) );
            if ( pkg?.scripts?.[ "docker:build" ] )
                return { cmd: "npm", args: [ "run", "docker:build" ], cwd: dir };
        }
        catch { /* fall through */ }

        return {
            cmd  : "docker",
            args : [ "build", "--build-arg", `APP_NAME=${service}`, "--build-arg", `APP_PATH=core/${service}`,
                     "-t", `rupapp-${service}:local`, "." ],
            cwd  : REPO_ROOT
        };
    }

    /** The `docker compose -f <file>` prefix args for a service, or undefined if it has no compose file. */
    private composeArgs( service : string ) : Array<string> | undefined
    {
        const dir : string = serviceDir( service );
        const composeFile : string | undefined = existsSync( join( dir, "docker-compose.yml" ) )
            ? join( dir, "docker-compose.yml" )
            : ( existsSync( join( dir, "docker-compose.yaml" ) ) ? join( dir, "docker-compose.yaml" ) : undefined );
        return composeFile ? [ "compose", "-f", composeFile ] : undefined;
    }

    /** The deploy-stage command for a target: `docker compose up` for compose, else `cdklocal deploy` to
     *  LocalStack. Returns an `{ error }` object if a compose deploy is requested but no compose file exists. */
    private deployCmd( service : string, target : DeployTarget ) : { cmd : string; args : Array<string>; cwd : string } | { error : string }
    {
        if ( target === "compose" )
        {
            const composePrefix : Array<string> | undefined = this.composeArgs( service );
            if ( !composePrefix ) return { error: `no docker-compose.yml in apps/core/${service}` };
            // detached so the deploy stage completes; runtime logs are followed separately
            return { cmd: "docker", args: [ ...composePrefix, "up", "--build", "-d" ], cwd: REPO_ROOT };
        }

        // cdklocal: deploy this service's stack(s) to LocalStack (glob stack selection)
        return { cmd: "npx", args: [ "cdklocal", "deploy", `*${service}*`, "-c", "env=local", "--require-approval", "never" ], cwd: CLOUD_DIR };
    }

    // ── runtime log follow (for compose deploys) ───────────────────────────────────────────────
    /** Tail the just-started compose containers' logs into the runtime stream (best-effort follow). */
    private followCompose( service : string ) : void
    {
        const composePrefix : Array<string> | undefined = this.composeArgs( service );
        if ( !composePrefix ) return;
        // `logs -f` follows the just-started containers; lands in the "runtime" stream
        this.run( service, "runtime", "docker", [ ...composePrefix, "logs", "-f", "--tail", "200" ], REPO_ROOT )
            .catch( () => { /* follow ended */ } );
    }

    /** `docker compose down` for a service (stops containers + the runtime follow). */
    async composeDown( service : string ) : Promise<number>
    {
        this.kill( service, "runtime" );
        const composePrefix : Array<string> | undefined = this.composeArgs( service );
        if ( !composePrefix ) return 0;
        return this.run( service, "deploy", "docker", [ ...composePrefix, "down" ], REPO_ROOT );
    }

    // ── long-running local dev processes (vite dev server, webproxy edge) ──────────────────────────

    // ── multi-role local run ───────────────────────────────────────────────────────────────────────
    // A service can have 1-N ROLES (e.g. app → main :8100 + public :8101). To mirror production locally
    // each role runs as its OWN process (SERVICE_ROLE + PORT) on its own port — `npm run dev` alone only
    // runs the default (main) role, so endpoints registered on other roles (e.g. bootstrap on public)
    // would never be served. All roles' output lands on the one "runtime" stream; the service counts as
    // running while ANY role process is live (one aggregate ProcState, so the UI's runtime flag is correct).
    private localGroups : Map<string, Map<string, ChildProcess>> = new Map<string, Map<string, ChildProcess>>();   // service → lane(role) → child
    private localStarting : Set<string> = new Set<string>();                            // services with a startLocal in flight (dedup)
    private tailers : Map<string, Array<ChildProcess>> = new Map<string, Array<ChildProcess>>();  // service → `docker logs -f` follows (LocalStack)

    // hot-reload watchdog state (see RELOAD_WATCHDOG_* + watchdogTick)
    private watchdogTimer? : ReturnType<typeof setInterval>;                                                        // the single poll loop (lazily started)
    private watchdog : Map<string, { pid? : number; pendingSince? : number; pidAtPending? : number }> = new Map();  // `${service}::${lane}` → reload-detection state
    private serviceSrcMtime : Map<string, number> = new Map();                                                      // service → newest source mtime last seen

    /** Count of a service's local role processes that are still alive. */
    private liveLocal( service : string ) : number
    {
        const group : Map<string, ChildProcess> | undefined = this.localGroups.get( service );
        if ( !group ) return 0;
        let liveCount : number = 0; for ( const child of group.values() ) if ( !child.killed ) liveCount++;
        return liveCount;
    }

    /** Spawn one role's local dev process (SERVICE_ROLE/PORT), tracked in the service's group. Reclaims
     *  the port first if a stale rup process (orphaned from a hard-killed console) is still holding it.
     *  Resolves once the process has been launched (or declined because the port is held) — so the caller
     *  can serialize and avoid double-spawns. */
    private spawnRole( service : string, role : string | undefined, port : number | undefined, extraEnv : NodeJS.ProcessEnv = {} ) : Promise<void>
    {
        const lane : string = role ?? "default";
        const label : string = role ? `${service}:${role}` : service;

        return new Promise<void>( ( resolve ) =>
        {
            const launch = () : void =>
            {
                const group : Map<string, ChildProcess> = this.localGroups.get( service ) ?? new Map();
                this.localGroups.set( service, group );

                const existing : ChildProcess | undefined = group.get( lane );   // never run two of the same role
                if ( existing && !existing.killed ) { try { existing.kill( "SIGKILL" ); } catch { /* */ } }

                // extraEnv carries the deployed LocalStack resource vars + AWS_ENDPOINT_URL; SERVICE_ROLE/PORT win
                const env : NodeJS.ProcessEnv = { ...extraEnv, ...( role ? { SERVICE_ROLE: role } : {} ), ...( port ? { PORT: String( port ) } : {} ) };
                logStore.sys( service, "runtime", `\n$ ${label} — npm run dev${port ? ` (PORT=${port})` : ""}` );
                try
                {
                    const child : ChildProcess = spawn( "npm", [ "run", "dev" ], { cwd: serviceDir( service ), env: { ...childEnv(), ...env }, shell: false } );
                    this.trackRole( service, lane, label, child );
                }
                catch ( err ) { logStore.sys( service, "runtime", `✖ failed to spawn ${label}: ${( err as Error ).message}` ); }
                resolve();
            };

            if ( !port ) { launch(); return; }
            void portFree( port ).then( ( free ) =>
            {
                if ( free ) { launch(); return; }
                if ( killStaleOnPort( port ) )
                {
                    logStore.sys( service, "runtime", `↻ reclaimed :${port} from a stale process — starting ${label}` );
                    setTimeout( launch, 500 );   // let the OS release the socket
                    return;
                }
                // not a stray rup process → say WHAT holds it (a Docker container, e.g. a LocalStack/compose leftover)
                const container : string | undefined = dockerContainerOnPort( port );
                logStore.sys( service, "runtime", container
                    ? `⚠ :${port} is held by Docker container "${container}" — stop it (Compose down / switch off LocalStack) to run ${label} locally`
                    : `⚠ :${port} is held by another process — stop it or change the port (${label} not started)` );
                resolve();
            } );
        } );
    }

    /** Wire a freshly-spawned role child into the group: log piping + aggregate running state. */
    private trackRole( service : string, lane : string, label : string, child : ChildProcess ) : void
    {
        const group : Map<string, ChildProcess> = this.localGroups.get( service ) ?? new Map();
        this.localGroups.set( service, group );
        group.set( lane, child );
        if ( this.liveLocal( service ) === 1 ) this.emitProc( service, "runtime", true, child.pid, label, null, Date.now() );

        child.stdout?.on( "data", ( data : Buffer ) => logStore.append( service, "runtime", "out", data.toString() ) );
        child.stderr?.on( "data", ( data : Buffer ) => logStore.append( service, "runtime", "err", data.toString() ) );
        child.on( "error", ( err ) => logStore.sys( service, "runtime", `✖ ${label}: ${err.message}` ) );
        child.on( "close", ( code, signal ) =>
        {
            if ( group.get( lane ) === child ) group.delete( lane );
            logStore.sys( service, "runtime", `■ ${label} exited${signal ? ` (${signal})` : ` (exit ${code ?? 0})`}` );
            if ( this.liveLocal( service ) === 0 ) this.emitProc( service, "runtime", false, undefined, label, code ?? 0, Date.now(), Date.now() );
        } );
    }

    /**
     * The deployed (LocalStack) container's resource env for a service — the CDK-injected resource
     * identifiers the {@link CloudResolver} reads (APPCONFIG_*, table/bucket names, AWS_REGION,
     * ENVIRONMENT, …). Lets a LOCAL `npm run dev` use the deployed LocalStack resources (AppConfig,
     * S3, …) without re-deploying. Empty if the service isn't deployed. Excludes PORT/SERVICE_ROLE
     * (set per role) + container-runtime noise (PATH/HOME/…) + AWS_ENDPOINT_URL (re-pointed at :4566).
     */
    private deployedEnv( service : string ) : Record<string, string>
    {
        const ports : Array<number> = ( getService( service )?.roles ?? [] ).filter( ( role ) => role.port > 0 ).map( ( role ) => role.port );
        const names : Array<string> = dockerContainersByContainerPort( ports );
        if ( names.length === 0 ) return {};
        try
        {
            const json    : string = execFileSync( "docker", [ "inspect", "--format", "{{json .Config.Env}}", names[ 0 ] ], { encoding: "utf8", env: childEnv() } );
            const entries : Array<string> = JSON.parse( json ) as Array<string>;
            // skip per-role + container-runtime vars; everything else is a CDK-injected resource identifier
            const denyList : Set<string> = new Set( [ "PORT", "SERVICE_ROLE", "AWS_ENDPOINT_URL", "PATH", "HOME", "HOSTNAME", "PWD", "TERM", "NODE_VERSION", "YARN_VERSION", "SHLVL", "_" ] );
            const env      : Record<string, string> = {};
            for ( const entry of entries )
            {
                const separatorIndex : number = entry.indexOf( "=" );
                if ( separatorIndex < 0 ) continue;
                const key : string = entry.slice( 0, separatorIndex );
                if ( !denyList.has( key ) ) env[ key ] = entry.slice( separatorIndex + 1 );
            }
            return env;
        }
        catch { return {}; }
    }

    /** Run a service locally — every role on its own port (or one default process if no ports are known).
     *  First brings DOWN the service's docker-compose containers if it has any: a containerized version
     *  publishes the same host ports, and Local can't share them — so switching to Local frees them.
     *  Inherits the DEPLOYED stack's resource env (+ points the SDK at LocalStack) so the local code uses
     *  the real LocalStack resources (AppConfig/S3/…) without a redeploy — deploy once, then iterate. */
    async startLocal( service : string ) : Promise<void>
    {
        // dedup: ignore a start while one's already in flight or the service is already running locally
        // (the auto-run on build + a manual "Run local" could otherwise both fire → double-spawn → EADDRINUSE)
        if ( this.localStarting.has( service ) || this.liveLocal( service ) > 0 ) return;
        this.localStarting.add( service );
        try
        {
            if ( this.composeArgs( service ) )   // service has a docker-compose.yml → tear down any running containers
            {
                logStore.sys( service, "runtime", "↓ docker compose down — freeing host ports for the local run…" );
                try { await this.composeDown( service ); } catch { /* nothing up / no compose */ }
            }

            // reap any ORPHAN dev process holding this service's ports (a prior session / a stray `turbo run
            // dev`) — whole tree, so a stale watcher can't respawn and re-grab the port. This is what keeps a
            // fresh run from being shadowed by env-less leftovers (see the registration-500 saga).
            const rolePorts : Array<number> = ( getService( service )?.roles ?? [] ).filter( ( role ) => role.port > 0 ).map( ( role ) => role.port );
            const reaped : number = reapOrphansOnPorts( rolePorts, this.ownedPids() );
            if ( reaped > 0 ) logStore.sys( service, "runtime", `↻ reclaimed ${reaped} orphan process tree(s) holding ${service}'s port(s) before starting` );

            // wire to the deployed LocalStack resources (if deployed) so AWS-backed code works locally
            const deployed : Record<string, string> = this.deployedEnv( service );
            const extra : NodeJS.ProcessEnv = Object.keys( deployed ).length
                ? { ...deployed, AWS_ENDPOINT_URL: "http://localhost:4566" }
                : {};
            // Local Kafka = the Redpanda side-container (docker-compose) on :9092 — override any in-cluster
            // broker list inherited from the deployed task so locally-run services publish/consume there.
            extra.KAFKA_BROKERS = process.env.KAFKA_BROKERS ?? "localhost:9092";
            logStore.sys( service, "runtime", Object.keys( deployed ).length
                ? `▶ wired to LocalStack — SDK → :4566 + ${Object.keys( deployed ).length} resource var(s) from the deployed stack (no redeploy needed)`
                : "ℹ not deployed to LocalStack — running standalone (AWS-backed features fall back to defaults). Deploy once to use its LocalStack resources." );

            const roles : Array<ServiceRole> = ( getService( service )?.roles ?? [] ).filter( ( role ) => role.port > 0 );
            if ( roles.length === 0 ) await this.spawnRole( service, undefined, undefined, extra );
            else await Promise.all( roles.map( ( role ) => this.spawnRole( service, role.role, role.port, extra ) ) );

            this.ensureWatchdog();   // safety-net poll for a stale tsx-watch file watcher
        }
        finally { this.localStarting.delete( service ); }
    }

    /** Stop all of a service's local role processes. */
    stopLocal( service : string ) : void
    {
        // forget watchdog detection state — a restart gets fresh pids/baseline (no false "stale" carryover)
        this.serviceSrcMtime.delete( service );
        for ( const key of [ ...this.watchdog.keys() ] ) if ( key.startsWith( `${service}::` ) ) this.watchdog.delete( key );

        const group : Map<string, ChildProcess> | undefined = this.localGroups.get( service );
        if ( !group ) return;
        for ( const child of group.values() )
        {
            try { child.kill( "SIGINT" ); setTimeout( () => { try { if ( !child.killed ) child.kill( "SIGKILL" ); } catch { /* */ } }, 4000 ); }
            catch { /* already gone */ }
        }
    }

    /**
     * Auto-run: ensure the local processes are up — start if down, RESTART (reload) if already up. A
     * rebuilt DEPENDENCY (@repo/*) won't restart `tsx watch` on its own (it only watches the service's
     * OWN src), so the orchestrator calls this after a build to avoid serving stale code/routes.
     */
    ensureLocal( service : string ) : void
    {
        if ( this.liveLocal( service ) > 0 )
        {
            this.stopLocal( service );
            logStore.sys( service, "runtime", "↻ restart after build — reloading rebuilt code/deps" );
            setTimeout( () => void this.startLocal( service ), 700 );   // let the listen ports free before rebinding
        }
        else void this.startLocal( service );
    }

    // ── hot-reload watchdog ──────────────────────────────────────────────────────────────────────────
    /** Start the single poll loop on first local run (idempotent). `unref` so it never keeps the app alive. */
    private ensureWatchdog() : void
    {
        if ( this.watchdogTimer ) return;
        this.watchdogTimer = setInterval( () => this.watchdogTick(), RELOAD_WATCHDOG_POLL_MS );
        this.watchdogTimer.unref?.();
    }

    /**
     * One poll tick: for each locally-running service, detect whether a source edit was picked up by
     * `tsx watch`. A reload spawns a NEW listener pid on the role's port, so:
     *   • source mtime advanced  → arm: remember "now" + the pid that was listening BEFORE the edit
     *   • pid changed since then  → healthy native reload, disarm
     *   • pid unchanged past GRACE → watcher is stale → restart the service locally
     * Restarting uses the proven stopLocal + startLocal path (also re-reads the deployed resource env).
     */
    private watchdogTick() : void
    {
        const now : number = Date.now();
        for ( const service of this.localGroups.keys() )
        {
            if ( this.liveLocal( service ) === 0 ) continue;        // nothing running → nothing to watch
            if ( this.localStarting.has( service ) ) continue;      // a start/restart is mid-flight → don't race it

            const roles : Array<ServiceRole> = ( getService( service )?.roles ?? [] ).filter( ( role ) => role.port > 0 );
            if ( roles.length === 0 ) continue;                     // no observable port (default-role service) → skip

            // newest source edit for this service; first sighting only records a baseline (no action)
            const currentMtime : number = newestSourceMtime( join( serviceDir( service ), "src" ) );
            const previousMtime : number | undefined = this.serviceSrcMtime.get( service );
            const sourceChanged : boolean = previousMtime !== undefined && currentMtime > previousMtime;
            this.serviceSrcMtime.set( service, currentMtime );

            let stale : boolean = false;
            for ( const role of roles )
            {
                const lane : string = role.role ?? "default";
                const key  : string = `${service}::${lane}`;
                const state = this.watchdog.get( key ) ?? {};
                const currentPid : number | undefined = listeningPid( role.port );

                if ( sourceChanged )
                {
                    // arm (or re-arm on a fresh edit — debounces a burst of saves to the LAST one). pidAtPending
                    // is the pid from the PREVIOUS tick — i.e. the listener that existed before this edit.
                    state.pendingSince = now;
                    state.pidAtPending = state.pid;
                }
                else if ( state.pendingSince !== undefined )
                {
                    if ( currentPid !== undefined && state.pidAtPending !== undefined && currentPid !== state.pidAtPending )
                        state.pendingSince = undefined;                                                       // reloaded on its own ⇒ healthy
                    else if ( now - state.pendingSince > RELOAD_WATCHDOG_GRACE_MS && currentPid !== undefined && currentPid === state.pidAtPending )
                        stale = true;                                                                          // edit not picked up in time ⇒ stale
                }

                state.pid = currentPid;
                this.watchdog.set( key, state );
            }

            if ( stale )
            {
                for ( const role of roles ) { const s = this.watchdog.get( `${service}::${role.role ?? "default"}` ); if ( s ) s.pendingSince = undefined; }
                logStore.sys( service, "runtime", `↻ watchdog — a source edit wasn't reloaded within ${RELOAD_WATCHDOG_GRACE_MS / 1000}s; the tsx-watch file watcher looks stale (common after sleep/wake). Restarting ${service} locally…` );
                this.stopLocal( service );
                setTimeout( () => void this.startLocal( service ), 800 );   // let listen ports free before rebinding
            }
        }
    }

    // ── deployed-log tail (LocalStack) ───────────────────────────────────────────────────────────────
    // In LocalStack mode a service runs as ECS task CONTAINERS (not a local process), so the Runtime tab
    // would be empty. These `docker logs -f` those containers (matched by the service's role ports) into
    // the same "runtime" stream — so the Runtime tab shows the deployed instance's output in either mode.

    /** True if we're currently tailing a service's deployed containers. */
    isTailing( service : string ) : boolean { return this.tailers.has( service ); }

    /** Map a service's role container-ports → their LocalStack-published host ports (from `docker ps`),
     *  so the API tester can hit the DEPLOYED instance directly (e.g. 8101 → 33934). Empty if not deployed. */
    deployedPorts( service : string ) : Record<number, number>
    {
        const rolePorts : Array<number> = ( getService( service )?.roles ?? [] ).filter( ( role ) => role.port > 0 ).map( ( role ) => role.port );
        if ( rolePorts.length === 0 ) return {};
        try
        {
            const psOutput : string = execFileSync( "docker", [ "ps", "--format", "{{.Ports}}" ], { encoding: "utf8", env: childEnv() } );
            const map : Record<number, number> = {};
            for ( const line of psOutput.split( "\n" ) )
            {
                // pull every <hostPort>-><containerPort> mapping out of the port column
                const mappingPattern : RegExp = /(\d+)->(\d+)\/tcp/g;
                let match : RegExpExecArray | null;
                while ( ( match = mappingPattern.exec( line ) ) !== null )
                {
                    const hostPort : number = Number( match[ 1 ] ), containerPort : number = Number( match[ 2 ] );
                    if ( rolePorts.includes( containerPort ) ) map[ containerPort ] = hostPort;
                }
            }
            return map;
        }
        catch { return {}; }
    }

    /** Start following the deployed (LocalStack ECS) containers' logs into the runtime stream. Idempotent. */
    tailDeployed( service : string ) : void
    {
        if ( this.tailers.has( service ) ) return;   // already tailing
        const ports : Array<number> = ( getService( service )?.roles ?? [] ).filter( ( r ) => r.port > 0 ).map( ( r ) => r.port );
        const names : Array<string> = dockerContainersByContainerPort( ports );
        if ( names.length === 0 ) { logStore.sys( service, "runtime", "no deployed containers found — deploy to LocalStack first" ); return; }

        const procs : Array<ChildProcess> = [];
        for ( const name of names )
        {
            logStore.sys( service, "runtime", `▶ tailing deployed container ${name}` );
            const child : ChildProcess = spawn( "docker", [ "logs", "-f", "--tail", "200", name ], { env: childEnv(), shell: false } );
            child.stdout?.on( "data", ( data : Buffer ) => logStore.append( service, "runtime", "out", data.toString() ) );
            child.stderr?.on( "data", ( data : Buffer ) => logStore.append( service, "runtime", "out", data.toString() ) );
            child.on( "error", ( err ) => logStore.sys( service, "runtime", `✖ tail ${name}: ${err.message}` ) );
            procs.push( child );
        }
        this.tailers.set( service, procs );
    }

    /** Stop following a service's deployed container logs. */
    stopTailDeployed( service : string ) : void
    {
        const procs : Array<ChildProcess> | undefined = this.tailers.get( service );
        if ( !procs ) return;
        for ( const child of procs ) { try { child.kill( "SIGTERM" ); } catch { /* gone */ } }
        this.tailers.delete( service );
        logStore.sys( service, "runtime", "■ stopped tailing deployed logs" );
    }

    /**
     * Refresh the proxy's per-endpoint route table from the LIVE endpoint→role bindings into `.active`.
     * Run on every proxy start so a stale `.active` (old upstream prefixes from a prior Apply) can never
     * misroute /api again — the freshly-generated route table always wins on /api. Preserves an existing
     * `.active`'s upstreams/modes (so a ProxyPanel "Apply" with Inside settings isn't clobbered); seeds
     * from the committed `local` config when there's no `.active` yet.
     */
    private refreshProxyRoutes() : void
    {
        try
        {
            // preserve the existing config's upstreams/modes, but always overwrite /api routes with the live table
            const baseConfig = readProxyConfig( activeConfigExists() ? ACTIVE_CONFIG : "local" ).config;
            if ( baseConfig ) writeActiveConfig( { ...baseConfig, routes: localApiRoutes() } );
        }
        catch { /* keep whatever config exists */ }
    }

    /** The local edge: run the webproxy with the console-generated `.active` config (else `local`). */
    startProxy( port? : number ) : void
    {
        // always regenerate the /api route table so a stale `.active` can't route old prefixes → SPA fallback
        this.refreshProxyRoutes();
        // the console writes `.active.json` from the routing board; fall back to committed `local`
        const configName : string = activeConfigExists() ? ACTIVE_CONFIG : "local";
        const args : Array<string> = [ "run", "dev", "--", "--config", configName ];
        const env : NodeJS.ProcessEnv | undefined = port ? { PORT: String( port ) } : undefined;
        const launchProxy = () : void => { void this.run( WEBPROXY_ID, "runtime", "npm", args, serviceDir( WEBPROXY_ID ), env ); };

        // If WE already manage the proxy, run() kills+respawns — fine. Otherwise the port may be held
        // by a STALE webproxy (orphaned from a prior session or a dev reload, where will-quit never
        // fires): reclaim it (kill + start our own managed instance). Only refuse if a genuinely
        // different (non-proxy) process holds the port.
        if ( this.isRunning( WEBPROXY_ID, "runtime" ) ) { launchProxy(); return; }
        const proxyPort : number = port ?? 8080;
        void portFree( proxyPort ).then( ( free ) =>
        {
            if ( free ) { launchProxy(); return; }
            if ( killStaleOnPort( proxyPort ) )
            {
                logStore.sys( WEBPROXY_ID, "runtime", `↻ reclaimed :${proxyPort} from a stale proxy — starting a fresh managed instance` );
                setTimeout( launchProxy, 700 );   // let the OS release the socket
            }
            else
            {
                logStore.sys( WEBPROXY_ID, "runtime", `⚠ port ${proxyPort} is held by another (non-proxy) process — stop it or change the port.` );
            }
        } );
    }

    /** Stop then re-launch the webproxy on the given port (waits for the port to free). */
    restartProxy( port? : number ) : void
    {
        this.kill( WEBPROXY_ID, "runtime" );
        setTimeout( () => this.startProxy( port ), 1200 );
    }

    /** Run `vite build --watch` so the deployed build (bin/) rebuilds incrementally on change. */
    startBuildWatch( service : string ) : void
    {
        void this.run( service, "build", "npx", [ "vite", "build", "--watch" ], serviceDir( service ) );
    }

    /** Run an arbitrary command, streaming to a (service, stream) log slot. Resolves with the exit code. */
    exec( service : string, stream : LogStream, cmd : string, args : Array<string>, cwd : string, env? : NodeJS.ProcessEnv ) : Promise<number>
    {
        return this.run( service, stream, cmd, args, cwd, env );
    }

    // ── the pipeline ─────────────────────────────────────────────────────────────────────────────
    /**
     * Run the requested stages (build → image → deploy) in canonical order, halting on the first
     * failure and marking the rest skipped. With `resume`, stages that already succeeded are kept and
     * skipped. Returns the final per-stage result.
     */
    async runPipeline( req : PipelineRequest ) : Promise<PipelineResult>
    {
        const svc : ServiceInfo | undefined = getService( req.service );
        const state : StageState = this.stageState( req.service );

        // selected stages, in canonical order
        const selected : Array<StageId> = STAGE_ORDER.filter( stage => req.stages.includes( stage ) );

        // reset selected stages we're about to (re)attempt; resume keeps prior successes
        for ( const stage of selected )
            if ( !( req.resume && state[ stage ] === "success" ) ) state[ stage ] = "idle";
        this.emit( "stage", req.service, { ...state } );

        for ( const stage of selected )
        {
            if ( req.resume && state[ stage ] === "success" )
            {
                logStore.sys( req.service, stage, "↷ skipped (already succeeded — resume)" );
                this.setStage( req.service, stage, "success" );
                continue;
            }

            // capability guard
            if ( stage === "build" && !svc?.capabilities.canBuild )
            { this.failRest( req.service, stage, selected, "service has no build script" ); return this.result( req.service, selected ); }
            if ( stage === "image" && !svc?.capabilities.canImage )
            { this.failRest( req.service, stage, selected, "service cannot build a Docker image" ); return this.result( req.service, selected ); }

            this.setStage( req.service, stage, "running" );

            // resolve + run the stage command
            let exit : number;
            if ( stage === "deploy" )
            {
                const command : { cmd : string; args : Array<string>; cwd : string } | { error : string } = this.deployCmd( req.service, req.target );
                if ( "error" in command )
                {
                    logStore.sys( req.service, "deploy", `✖ ${command.error}` );
                    this.failRest( req.service, stage, selected, command.error );
                    return this.result( req.service, selected );
                }
                exit = await this.run( req.service, "deploy", command.cmd, command.args, command.cwd );
                if ( exit === 0 && req.target === "compose" ) this.followCompose( req.service );
            }
            else
            {
                const command : { cmd : string; args : Array<string>; cwd : string } = stage === "build" ? this.buildCmd( req.service ) : this.imageCmd( req.service );
                exit = await this.run( req.service, stage, command.cmd, command.args, command.cwd );
            }

            if ( exit !== 0 )
            {
                // HALT on first failure — do NOT roll back; mark the rest skipped so a resume re-runs from here
                this.setStage( req.service, stage, "failed" );
                this.skipAfter( req.service, stage, selected );
                return this.result( req.service, selected );
            }

            this.setStage( req.service, stage, "success" );
        }

        return this.result( req.service, selected );
    }

    /** Log a reason, mark the current stage failed, and skip the remaining selected stages. */
    private failRest( service : string, stage : StageId, selected : Array<StageId>, why : string ) : void
    {
        logStore.sys( service, stage, `✖ ${why}` );
        this.setStage( service, stage, "failed" );
        this.skipAfter( service, stage, selected );
    }

    /** Mark every selected stage after `stage` as skipped. */
    private skipAfter( service : string, stage : StageId, selected : Array<StageId> ) : void
    {
        const stageIndex : number = selected.indexOf( stage );
        for ( const later of selected.slice( stageIndex + 1 ) ) this.setStage( service, later, "skipped" );
    }

    /** Build the PipelineResult — `ok` true only if every selected stage succeeded. */
    private result( service : string, selected : Array<StageId> ) : PipelineResult
    {
        const state : StageState = this.stageState( service );
        const ok : boolean = selected.every( stage => state[ stage ] === "success" );
        return { service, stages: { ...state }, ok };
    }
}

export const processManager = new ProcessManager();
