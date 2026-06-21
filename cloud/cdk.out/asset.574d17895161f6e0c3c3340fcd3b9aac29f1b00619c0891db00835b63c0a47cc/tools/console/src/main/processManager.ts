import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { delimiter, join } from "node:path";
import { EventEmitter } from "node:events";

import {
    STAGE_ORDER, WEBPROXY_ID,
    type DeployTarget, type LogStream, type PipelineRequest, type PipelineResult,
    type ProcState, type ServiceInfo, type StageId, type StageState, type StageStatus
} from "../shared/types";
import { getService } from "./registry";
import { logStore } from "./logStore";
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
        return this.slots.has( this.slotKey( service, stream ) );
    }

    // ── spawning ───────────────────────────────────────────────────────────────────────────────
    /**
     * Spawn `cmd args` in `cwd`, piping output to the (service, stream) log. Resolves with the exit
     * code (0 = success). Rejects only on spawn error. One slot per (service, stream) — a new spawn
     * for an occupied slot kills the previous process first.
     */
    private run( service : string, stream : LogStream, cmd : string, args : string[], cwd : string ) : Promise<number>
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
                child = spawn( cmd, args, { cwd, env: childEnv(), shell: false } );
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

    /** Stop every running stream for a service (build/image/deploy/runtime). */
    killAll( service : string ) : void
    {
        for ( const stream of [ "build", "image", "deploy", "runtime" ] as LogStream[] )
            this.kill( service, stream );
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

    /** Start a frontend's vite dev server (HMR). Long-running → fire-and-forget on the runtime stream. */
    startDev( service : string ) : void
    {
        void this.run( service, "runtime", "npm", [ "run", "dev" ], serviceDir( service ) );
    }

    /** The local edge: run the webproxy (serves the built SPA + proxies API/WS to services). */
    startProxy() : void
    {
        void this.run( WEBPROXY_ID, "runtime", "npm", [ "run", "dev" ], serviceDir( WEBPROXY_ID ) );
    }

    /** Run `vite build --watch` so the deployed build (bin/) rebuilds incrementally on change. */
    startBuildWatch( service : string ) : void
    {
        void this.run( service, "build", "npx", [ "vite", "build", "--watch" ], serviceDir( service ) );
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
