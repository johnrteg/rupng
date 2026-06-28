import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { delimiter, join } from "node:path";
import { EventEmitter } from "node:events";
import { createServer } from "node:net";

import {
    STAGE_ORDER, WEBPROXY_ID,
    type DeployTarget, type LogStream, type PipelineRequest, type PipelineResult,
    type ProcState, type ServiceInfo, type ServiceRole, type StageId, type StageState, type StageStatus
} from "../shared/types";
import { getService } from "./registry";
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
    const extra : string[] = [ "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin" ];
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
        const pids : string[] = execFileSync( "lsof", [ "-ti", `tcp:${port}` ], { encoding: "utf8", env: SYS_ENV } )
            .split( "\n" ).map( ( s ) => s.trim() ).filter( Boolean );
        let killed : boolean = false;
        for ( const pid of pids )
        {
            let cmd : string = "";
            try { cmd = execFileSync( "ps", [ "-o", "command=", "-p", pid ], { encoding: "utf8", env: SYS_ENV } ); } catch { /* already gone */ }
            const isRup : boolean = /webproxy|proxy@/.test( cmd ) || ( /tsx/.test( cmd ) && /src\/index\.ts/.test( cmd ) );
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
        const out : string = execFileSync( "docker", [ "ps", "--format", "{{.Names}}\t{{.Ports}}" ], { encoding: "utf8", env: childEnv() } );
        for ( const line of out.split( "\n" ) )
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
function dockerContainersByContainerPort( ports : number[] ) : string[]
{
    if ( ports.length === 0 ) return [];
    try
    {
        const out : string = execFileSync( "docker", [ "ps", "--format", "{{.Names}}\t{{.Ports}}" ], { encoding: "utf8", env: childEnv() } );
        const names : string[] = [];
        for ( const line of out.split( "\n" ) )
        {
            const [ name, portsStr ] = line.split( "\t" );
            if ( name && portsStr && ports.some( ( p ) => new RegExp( `->${p}/` ).test( portsStr ) ) ) names.push( name );
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
        const srv = createServer();
        srv.once( "error", () => resolve( false ) );
        srv.once( "listening", () => srv.close( () => resolve( true ) ) );
        srv.listen( port, "0.0.0.0" );
    } );
}

/** Local wall-clock stamp "YYYY-MM-DD HH:MM:SS" for stage start/end lines. */
function clock( ms : number ) : string
{
    const d : Date = new Date( ms );
    const p = ( n : number ) : string => String( n ).padStart( 2, "0" );
    return `${d.getFullYear()}-${p( d.getMonth() + 1 )}-${p( d.getDate() )} ${p( d.getHours() )}:${p( d.getMinutes() )}:${p( d.getSeconds() )}`;
}

/** Human elapsed time: "450ms", "3.4s", "2m 03s", "1h 02m 03s". */
function duration( ms : number ) : string
{
    if ( ms < 1000 ) return `${ms}ms`;
    const s : number = Math.round( ms / 100 ) / 10;            // tenths of a second
    if ( s < 60 ) return `${s}s`;
    const total : number = Math.round( ms / 1000 );
    const h : number = Math.floor( total / 3600 );
    const m : number = Math.floor( ( total % 3600 ) / 60 );
    const sec : number = total % 60;
    const p = ( n : number ) : string => String( n ).padStart( 2, "0" );
    return h > 0 ? `${h}h ${p( m )}m ${p( sec )}s` : `${m}m ${p( sec )}s`;
}

class ProcessManager extends EventEmitter
{
    private slots = new Map<string, Slot>();
    private stages = new Map<string, StageState>();

    private slotKey( service : string, stream : LogStream ) : string { return `${service}:${stream}`; }

    // ── stage state ───────────────────────────────────────────────────────────────────────────
    stageState( service : string ) : StageState
    {
        let s = this.stages.get( service );
        if ( !s ) { s = { build: "idle", image: "idle", deploy: "idle" }; this.stages.set( service, s ); }
        return s;
    }

    private setStage( service : string, stage : StageId, status : StageStatus ) : void
    {
        const s : StageState = this.stageState( service );
        s[ stage ] = status;
        this.emit( "stage", service, { ...s } );
    }

    allStageStates() : Record<string, StageState>
    {
        const out : Record<string, StageState> = {};
        for ( const [ k, v ] of this.stages ) out[ k ] = { ...v };
        return out;
    }

    /** Set a service's stage status (running/success/failed) — used by the build orchestrator to drive
     *  the per-stage dots + service-button indicator lights (esp. the deploy step it runs itself). */
    setStageStatus( service : string, stage : StageId, status : StageStatus ) : void { this.setStage( service, stage, status ); }

    /** Run just the Build stage (turbo), driving its dot from the exit code. Returns true on success. */
    async runBuildStage( service : string ) : Promise<boolean>
    {
        this.setStage( service, "build", "running" );
        const c : { cmd : string; args : string[]; cwd : string } = this.buildCmd( service );
        const ok : boolean = ( await this.run( service, "build", c.cmd, c.args, c.cwd ) ) === 0;
        this.setStage( service, "build", ok ? "success" : "failed" );
        return ok;
    }

    /** Run just the Docker-image stage, driving its dot from the exit code. Returns true on success. */
    async runImageStage( service : string ) : Promise<boolean>
    {
        this.setStage( service, "image", "running" );
        const c : { cmd : string; args : string[]; cwd : string } = this.imageCmd( service );
        const ok : boolean = ( await this.run( service, "image", c.cmd, c.args, c.cwd ) ) === 0;
        this.setStage( service, "image", ok ? "success" : "failed" );
        return ok;
    }

    // ── process state ───────────────────────────────────────────────────────────────────────────
    procStates() : ProcState[]
    {
        const out : ProcState[] = [];
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
    private run( service : string, stream : LogStream, cmd : string, args : string[], cwd : string, env? : NodeJS.ProcessEnv ) : Promise<number>
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

            child.stdout?.on( "data", ( d : Buffer ) => logStore.append( service, stream, "out", d.toString() ) );
            child.stderr?.on( "data", ( d : Buffer ) => logStore.append( service, stream, "err", d.toString() ) );

            child.on( "error", ( err ) =>
            {
                logStore.sys( service, stream, `✖ ${err.message}` );
            } );

            child.on( "close", ( code, signal ) =>
            {
                this.slots.delete( key );
                const exit  : number = code ?? ( signal ? 1 : 0 );
                const ended : number = Date.now();
                const head  : string = signal ? `■ terminated (${signal})` : ( exit === 0 ? `✔ done (exit 0)` : `✖ exit ${exit}` );
                logStore.sys( service, stream, `${head} · ended ${clock( ended )} · took ${duration( ended - startedAt )}` );
                this.emitProc( service, stream, false, undefined, command, exit, startedAt, ended );
                resolve( exit );
            } );
        } );
    }

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
        for ( const stream of [ "build", "image", "deploy", "runtime" ] as LogStream[] )
            this.kill( service, stream );
        this.stopLocal( service );
        this.stopTailDeployed( service );
    }

    /** Kill EVERY managed child immediately — called on app quit so nothing orphans (esp. the proxy
     *  on :9000, which would otherwise still hold the port on the next launch → "address in use"). */
    shutdown() : void
    {
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
    private buildCmd( service : string ) : { cmd : string; args : string[]; cwd : string }
    {
        // path-based turbo filter — robust to package-name ≠ dir-name
        return { cmd: "npx", args: [ "turbo", "run", "build", `--filter=./apps/core/${service}` ], cwd: REPO_ROOT };
    }

    private imageCmd( service : string ) : { cmd : string; args : string[]; cwd : string }
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

    private composeArgs( service : string ) : string[] | undefined
    {
        const dir : string = serviceDir( service );
        const yml : string | undefined = existsSync( join( dir, "docker-compose.yml" ) )
            ? join( dir, "docker-compose.yml" )
            : ( existsSync( join( dir, "docker-compose.yaml" ) ) ? join( dir, "docker-compose.yaml" ) : undefined );
        return yml ? [ "compose", "-f", yml ] : undefined;
    }

    private deployCmd( service : string, target : DeployTarget ) : { cmd : string; args : string[]; cwd : string } | { error : string }
    {
        if ( target === "compose" )
        {
            const base : string[] | undefined = this.composeArgs( service );
            if ( !base ) return { error: `no docker-compose.yml in apps/core/${service}` };
            // detached so the deploy stage completes; runtime logs are followed separately
            return { cmd: "docker", args: [ ...base, "up", "--build", "-d" ], cwd: REPO_ROOT };
        }

        // cdklocal: deploy this service's stack(s) to LocalStack (glob stack selection)
        return { cmd: "npx", args: [ "cdklocal", "deploy", `*${service}*`, "-c", "env=local", "--require-approval", "never" ], cwd: CLOUD_DIR };
    }

    // ── runtime log follow (for compose deploys) ───────────────────────────────────────────────
    private followCompose( service : string ) : void
    {
        const base : string[] | undefined = this.composeArgs( service );
        if ( !base ) return;
        // `logs -f` follows the just-started containers; lands in the "runtime" stream
        this.run( service, "runtime", "docker", [ ...base, "logs", "-f", "--tail", "200" ], REPO_ROOT )
            .catch( () => { /* follow ended */ } );
    }

    /** `docker compose down` for a service (stops containers + the runtime follow). */
    async composeDown( service : string ) : Promise<number>
    {
        this.kill( service, "runtime" );
        const base : string[] | undefined = this.composeArgs( service );
        if ( !base ) return 0;
        return this.run( service, "deploy", "docker", [ ...base, "down" ], REPO_ROOT );
    }

    // ── long-running local dev processes (vite dev server, webproxy edge) ──────────────────────────

    // ── multi-role local run ───────────────────────────────────────────────────────────────────────
    // A service can have 1-N ROLES (e.g. app → main :8100 + public :8101). To mirror production locally
    // each role runs as its OWN process (SERVICE_ROLE + PORT) on its own port — `npm run dev` alone only
    // runs the default (main) role, so endpoints registered on other roles (e.g. bootstrap on public)
    // would never be served. All roles' output lands on the one "runtime" stream; the service counts as
    // running while ANY role process is live (one aggregate ProcState, so the UI's runtime flag is correct).
    private localGroups = new Map<string, Map<string, ChildProcess>>();   // service → lane(role) → child
    private localStarting = new Set<string>();                            // services with a startLocal in flight (dedup)
    private tailers = new Map<string, ChildProcess[]>();                  // service → `docker logs -f` follows (LocalStack)

    private liveLocal( service : string ) : number
    {
        const g = this.localGroups.get( service );
        if ( !g ) return 0;
        let n = 0; for ( const c of g.values() ) if ( !c.killed ) n++;
        return n;
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

        child.stdout?.on( "data", ( d : Buffer ) => logStore.append( service, "runtime", "out", d.toString() ) );
        child.stderr?.on( "data", ( d : Buffer ) => logStore.append( service, "runtime", "err", d.toString() ) );
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
        const ports : number[] = ( getService( service )?.roles ?? [] ).filter( ( r ) => r.port > 0 ).map( ( r ) => r.port );
        const names : string[] = dockerContainersByContainerPort( ports );
        if ( names.length === 0 ) return {};
        try
        {
            const json : string = execFileSync( "docker", [ "inspect", "--format", "{{json .Config.Env}}", names[ 0 ] ], { encoding: "utf8", env: childEnv() } );
            const arr  : string[] = JSON.parse( json ) as string[];
            const deny : Set<string> = new Set( [ "PORT", "SERVICE_ROLE", "AWS_ENDPOINT_URL", "PATH", "HOME", "HOSTNAME", "PWD", "TERM", "NODE_VERSION", "YARN_VERSION", "SHLVL", "_" ] );
            const env  : Record<string, string> = {};
            for ( const entry of arr )
            {
                const i : number = entry.indexOf( "=" );
                if ( i < 0 ) continue;
                const k : string = entry.slice( 0, i );
                if ( !deny.has( k ) ) env[ k ] = entry.slice( i + 1 );
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

            const roles : ServiceRole[] = ( getService( service )?.roles ?? [] ).filter( ( r ) => r.port > 0 );
            if ( roles.length === 0 ) await this.spawnRole( service, undefined, undefined, extra );
            else await Promise.all( roles.map( ( r ) => this.spawnRole( service, r.role, r.port, extra ) ) );
        }
        finally { this.localStarting.delete( service ); }
    }

    /** Stop all of a service's local role processes. */
    stopLocal( service : string ) : void
    {
        const g = this.localGroups.get( service );
        if ( !g ) return;
        for ( const child of g.values() )
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
        const rolePorts : number[] = ( getService( service )?.roles ?? [] ).filter( ( r ) => r.port > 0 ).map( ( r ) => r.port );
        if ( rolePorts.length === 0 ) return {};
        try
        {
            const out : string = execFileSync( "docker", [ "ps", "--format", "{{.Ports}}" ], { encoding: "utf8", env: childEnv() } );
            const map : Record<number, number> = {};
            for ( const line of out.split( "\n" ) )
            {
                const re = /(\d+)->(\d+)\/tcp/g;   // <hostPort>-><containerPort>
                let m : RegExpExecArray | null;
                while ( ( m = re.exec( line ) ) !== null )
                {
                    const host : number = Number( m[ 1 ] ), container : number = Number( m[ 2 ] );
                    if ( rolePorts.includes( container ) ) map[ container ] = host;
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
        const ports : number[] = ( getService( service )?.roles ?? [] ).filter( ( r ) => r.port > 0 ).map( ( r ) => r.port );
        const names : string[] = dockerContainersByContainerPort( ports );
        if ( names.length === 0 ) { logStore.sys( service, "runtime", "no deployed containers found — deploy to LocalStack first" ); return; }

        const procs : ChildProcess[] = [];
        for ( const name of names )
        {
            logStore.sys( service, "runtime", `▶ tailing deployed container ${name}` );
            const child : ChildProcess = spawn( "docker", [ "logs", "-f", "--tail", "200", name ], { env: childEnv(), shell: false } );
            child.stdout?.on( "data", ( d : Buffer ) => logStore.append( service, "runtime", "out", d.toString() ) );
            child.stderr?.on( "data", ( d : Buffer ) => logStore.append( service, "runtime", "out", d.toString() ) );
            child.on( "error", ( err ) => logStore.sys( service, "runtime", `✖ tail ${name}: ${err.message}` ) );
            procs.push( child );
        }
        this.tailers.set( service, procs );
    }

    /** Stop following a service's deployed container logs. */
    stopTailDeployed( service : string ) : void
    {
        const procs = this.tailers.get( service );
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
            const base = readProxyConfig( activeConfigExists() ? ACTIVE_CONFIG : "local" ).config;
            if ( base ) writeActiveConfig( { ...base, routes: localApiRoutes() } );
        }
        catch { /* keep whatever config exists */ }
    }

    /** The local edge: run the webproxy with the console-generated `.active` config (else `local`). */
    startProxy( port? : number ) : void
    {
        // always regenerate the /api route table so a stale `.active` can't route old prefixes → SPA fallback
        this.refreshProxyRoutes();
        // the console writes `.active.json` from the routing board; fall back to committed `local`
        const name : string = activeConfigExists() ? ACTIVE_CONFIG : "local";
        const args : string[] = [ "run", "dev", "--", "--config", name ];
        const env : NodeJS.ProcessEnv | undefined = port ? { PORT: String( port ) } : undefined;
        const spawn = () : void => { void this.run( WEBPROXY_ID, "runtime", "npm", args, serviceDir( WEBPROXY_ID ), env ); };

        // If WE already manage the proxy, run() kills+respawns — fine. Otherwise the port may be held
        // by a STALE webproxy (orphaned from a prior session or a dev reload, where will-quit never
        // fires): reclaim it (kill + start our own managed instance). Only refuse if a genuinely
        // different (non-proxy) process holds the port.
        if ( this.isRunning( WEBPROXY_ID, "runtime" ) ) { spawn(); return; }
        const p : number = port ?? 8080;
        void portFree( p ).then( ( free ) =>
        {
            if ( free ) { spawn(); return; }
            if ( killStaleOnPort( p ) )
            {
                logStore.sys( WEBPROXY_ID, "runtime", `↻ reclaimed :${p} from a stale proxy — starting a fresh managed instance` );
                setTimeout( spawn, 700 );   // let the OS release the socket
            }
            else
            {
                logStore.sys( WEBPROXY_ID, "runtime", `⚠ port ${p} is held by another (non-proxy) process — stop it or change the port.` );
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
    exec( service : string, stream : LogStream, cmd : string, args : string[], cwd : string, env? : NodeJS.ProcessEnv ) : Promise<number>
    {
        return this.run( service, stream, cmd, args, cwd, env );
    }

    // ── the pipeline ─────────────────────────────────────────────────────────────────────────────
    async runPipeline( req : PipelineRequest ) : Promise<PipelineResult>
    {
        const svc : ServiceInfo | undefined = getService( req.service );
        const state : StageState = this.stageState( req.service );

        // selected stages, in canonical order
        const selected = STAGE_ORDER.filter( s => req.stages.includes( s ) );

        // reset selected stages we're about to (re)attempt; resume keeps prior successes
        for ( const s of selected )
            if ( !( req.resume && state[ s ] === "success" ) ) state[ s ] = "idle";
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
                const c : { cmd : string; args : string[]; cwd : string } | { error : string } = this.deployCmd( req.service, req.target );
                if ( "error" in c )
                {
                    logStore.sys( req.service, "deploy", `✖ ${c.error}` );
                    this.failRest( req.service, stage, selected, c.error );
                    return this.result( req.service, selected );
                }
                exit = await this.run( req.service, "deploy", c.cmd, c.args, c.cwd );
                if ( exit === 0 && req.target === "compose" ) this.followCompose( req.service );
            }
            else
            {
                const c : { cmd : string; args : string[]; cwd : string } = stage === "build" ? this.buildCmd( req.service ) : this.imageCmd( req.service );
                exit = await this.run( req.service, stage, c.cmd, c.args, c.cwd );
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

    private failRest( service : string, stage : StageId, selected : StageId[], why : string ) : void
    {
        logStore.sys( service, stage, `✖ ${why}` );
        this.setStage( service, stage, "failed" );
        this.skipAfter( service, stage, selected );
    }

    private skipAfter( service : string, stage : StageId, selected : StageId[] ) : void
    {
        const idx : number = selected.indexOf( stage );
        for ( const later of selected.slice( idx + 1 ) ) this.setStage( service, later, "skipped" );
    }

    private result( service : string, selected : StageId[] ) : PipelineResult
    {
        const state : StageState = this.stageState( service );
        const ok : boolean = selected.every( s => state[ s ] === "success" );
        return { service, stages: { ...state }, ok };
    }
}

export const processManager = new ProcessManager();
