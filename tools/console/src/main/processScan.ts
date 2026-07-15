import { execFileSync } from "node:child_process";
import { basename, join } from "node:path";

import type { ProcessListing, ReapResult, RupProcess, RupProcessKind } from "../shared/types";
import { APPS_CORE, REPO_ROOT } from "./paths";
import { listServices } from "./registry";

//
// Process monitor backend.
//
// The console only tracks processes IT spawned this session. Orphans from a prior (hard-killed) session
// or a separate `turbo run dev` are invisible to it — they silently hold ports and run with stale/missing
// env, shadowing fresh runs. This module scans the OS for ALL rup-related processes (regardless of who
// started them), classifies each as owned-by-this-session vs orphan, and can kill whole process trees
// (parent npm/turbo included, so nothing respawns).
//
// Safety: the Electron console itself never matches the rup pattern, and we additionally GUARD the
// console's own pid + its ancestors and skip any process whose cwd is under tools/ (e.g. the console's
// own vite dev server). Only genuine rup-app dev processes are ever reaped.
//

/** PATH with the usual system bins so `ps`/`lsof` resolve even when launched from Finder. */
const SYS_ENV : NodeJS.ProcessEnv = { ...process.env, PATH: [ process.env.PATH ?? "", "/usr/sbin", "/usr/bin", "/bin", "/sbin" ].filter( Boolean ).join( ":" ) };

// A rup dev/process we manage or could orphan: a service dev server (tsx … src/index.ts), the web/vite
// dev server, a top-level `turbo run dev`, a `cdklocal` deploy, or the webproxy. The Electron app and its
// helpers never match this.
const RUP_PATTERN : RegExp = /(?:\btsx\b.*src\/index\.ts|node_modules\/\.bin\/vite\b|\/vite(?:\.js)?\b|turbo run dev|\bcdklocal\b|webproxy|proxy@)/;

/** One row of `ps` output. */
interface PsRow { pid : number; ppid : number; startedAt? : number; command : string; }

/** Snapshot every process: pid, ppid, start time, full command. */
function psTable() : Array<PsRow>
{
    const rows : Array<PsRow> = [];
    try
    {
        const out : string = execFileSync( "ps", [ "-axww", "-o", "pid=,ppid=,lstart=,command=" ], { encoding: "utf8", env: SYS_ENV, maxBuffer: 8 * 1024 * 1024 } );
        for ( const line of out.split( "\n" ) )
        {
            const trimmed : string = line.trim();
            if ( !trimmed ) continue;
            const parts : Array<string> = trimmed.split( /\s+/ );
            if ( parts.length < 8 ) continue;
            const pid  : number = Number( parts[ 0 ] );
            const ppid : number = Number( parts[ 1 ] );
            if ( !Number.isFinite( pid ) ) continue;
            const lstart  : string = parts.slice( 2, 7 ).join( " " );   // "Mon Jun 29 16:27:08 2026"
            const command : string = parts.slice( 7 ).join( " " );
            const parsed  : number = Date.parse( lstart );
            rows.push( { pid, ppid, startedAt: Number.isFinite( parsed ) ? parsed : undefined, command } );
        }
    }
    catch { /* ps unavailable */ }
    return rows;
}

/** pid → the TCP port it LISTENs on (one `lsof` pass). A reload swaps this pid, so it's also how the
 *  watchdog/monitor tells a live listener apart from a parent npm/tsx. */
function listenerPorts() : Map<number, number>
{
    const map : Map<number, number> = new Map();
    try
    {
        const out : string = execFileSync( "lsof", [ "-nP", "-iTCP", "-sTCP:LISTEN" ], { encoding: "utf8", env: SYS_ENV, maxBuffer: 8 * 1024 * 1024 } );
        for ( const line of out.split( "\n" ).slice( 1 ) )   // skip header
        {
            const tokens : Array<string> = line.trim().split( /\s+/ );
            if ( tokens.length < 9 ) continue;
            const pid   : number = Number( tokens[ 1 ] );
            const match : RegExpMatchArray | null = tokens[ 8 ].match( /:(\d+)$/ );   // NAME col, e.g. *:8110 / 127.0.0.1:9000
            if ( Number.isFinite( pid ) && match ) map.set( pid, Number( match[ 1 ] ) );
        }
    }
    catch { /* lsof unavailable */ }
    return map;
}

/** A process's current working directory, via `lsof` (used to confirm a tsx/vite process is a rup-app
 *  one — cwd under apps/core — and to read its service id from the dir name). */
function cwdOf( pid : number ) : string | undefined
{
    try
    {
        const out : string = execFileSync( "lsof", [ "-a", "-d", "cwd", "-p", String( pid ), "-Fn", "-nP" ], { encoding: "utf8", env: SYS_ENV } );
        const nameLine : string | undefined = out.split( "\n" ).find( ( line ) => line.startsWith( "n" ) );
        return nameLine ? nameLine.slice( 1 ) : undefined;
    }
    catch { return undefined; }
}

/** Grow a seed pid set to include every descendant (so a tracked npm child's whole tsx/node tree counts). */
function withDescendants( seeds : Set<number>, rows : Array<PsRow> ) : Set<number>
{
    const result : Set<number> = new Set( seeds );
    let grew : boolean = true;
    while ( grew )
    {
        grew = false;
        for ( const row of rows ) if ( !result.has( row.pid ) && result.has( row.ppid ) ) { result.add( row.pid ); grew = true; }
    }
    return result;
}

/** The ancestor chain of `pid` (so we never reap the console's own launcher/shell). */
function ancestorsOf( pid : number, byPid : Map<number, PsRow> ) : Set<number>
{
    const chain : Set<number> = new Set();
    let current : number | undefined = byPid.get( pid )?.ppid;
    while ( current && current > 1 && !chain.has( current ) ) { chain.add( current ); current = byPid.get( current )?.ppid; }
    return chain;
}

/** Build port → { service, role } from the live registry, so a listening process resolves to its service/role. */
function portIndex() : Map<number, { service : string; role : string }>
{
    const index : Map<number, { service : string; role : string }> = new Map();
    for ( const service of listServices() )
        for ( const role of service.roles ) if ( role.port > 0 ) index.set( role.port, { service: service.id, role: role.role } );
    return index;
}

/** A process whose cwd lives in the console's own tree (tools/…) — its dev vite, never a rup app. */
function isConsoleOwnCwd( cwd : string | undefined ) : boolean
{
    return cwd !== undefined && cwd.startsWith( join( REPO_ROOT, "tools" ) );
}

/** Does this command look like it needs a cwd check (tsx service / vite) to confirm it's a rup app? */
function needsCwd( command : string ) : boolean
{
    return /\btsx\b.*src\/index\.ts/.test( command ) || /\/vite(?:\.js)?\b/.test( command ) || /node_modules\/\.bin\/vite\b/.test( command );
}

/** Classify a matched rup process into a kind + (best-effort) service/role. */
function classify( row : PsRow, cwd : string | undefined, port : number | undefined, ports : Map<number, { service : string; role : string }> )
    : { kind : RupProcessKind; service? : string; role? : string }
{
    if ( /turbo run dev/.test( row.command ) ) return { kind: "turbo" };
    if ( /\bcdklocal\b/.test( row.command ) )  return { kind: "cdklocal" };

    const fromCwd : string | undefined = cwd && cwd.startsWith( APPS_CORE ) ? basename( cwd ) : undefined;
    const fromPort : { service : string; role : string } | undefined = port !== undefined ? ports.get( port ) : undefined;
    const service : string | undefined = fromCwd ?? fromPort?.service;

    if ( service === "webproxy" || /webproxy|proxy@/.test( row.command ) ) return { kind: "proxy", service: service ?? "webproxy", role: fromPort?.role };
    if ( service === "web" || /\/vite(?:\.js)?\b/.test( row.command ) || /node_modules\/\.bin\/vite\b/.test( row.command ) ) return { kind: "web", service: service ?? "web" };
    if ( /src\/index\.ts/.test( row.command ) ) return { kind: "service", service, role: fromPort?.role };
    return { kind: "other", service, role: fromPort?.role };
}

/** Scan the OS for all rup processes, classified + tagged owned/orphan. `ownedRoots` are the pids the
 *  console currently tracks (their whole trees are treated as owned). */
export function scanProcesses( ownedRoots : Array<number> ) : ProcessListing
{
    try
    {
        const rows  : Array<PsRow> = psTable();
        const byPid : Map<number, PsRow> = new Map( rows.map( ( row ) => [ row.pid, row ] ) );
        const owned : Set<number> = withDescendants( new Set( ownedRoots ), rows );
        const guard : Set<number> = ancestorsOf( process.pid, byPid ); guard.add( process.pid );
        const listen : Map<number, number> = listenerPorts();
        const ports  : Map<number, { service : string; role : string }> = portIndex();
        const now    : number = Date.now();

        const processes : Array<RupProcess> = [];
        for ( const row of rows )
        {
            if ( !RUP_PATTERN.test( row.command ) ) continue;
            const cwd : string | undefined = needsCwd( row.command ) ? cwdOf( row.pid ) : undefined;
            if ( isConsoleOwnCwd( cwd ) ) continue;   // the console's own dev vite — not a rup app

            const port : number | undefined = listen.get( row.pid );
            const { kind, service, role } = classify( row, cwd, port, ports );
            processes.push( {
                pid: row.pid, ppid: row.ppid, kind, service, role, port,
                command: row.command.length > 140 ? row.command.slice( 0, 140 ) + "…" : row.command,
                startedAt: row.startedAt,
                ageSec: row.startedAt ? Math.max( 0, Math.round( ( now - row.startedAt ) / 1000 ) ) : 0,
                owned: owned.has( row.pid ) || guard.has( row.pid ),
            } );
        }
        // owned first, then by service/port for a stable read
        processes.sort( ( a, b ) => Number( b.owned ) - Number( a.owned ) || ( a.service ?? "" ).localeCompare( b.service ?? "" ) || ( a.port ?? 0 ) - ( b.port ?? 0 ) );
        return { ok: true, processes };
    }
    catch ( err ) { return { ok: false, processes: [], error: ( err as Error ).message }; }
}

/** SIGTERM a pid's whole tree, then SIGKILL any survivor shortly after. */
export function killProcessTree( pid : number ) : void
{
    const rows : Array<PsRow> = psTable();
    const tree : Array<number> = [ ...withDescendants( new Set( [ pid ] ), rows ) ];
    for ( const target of tree ) { try { process.kill( target, "SIGTERM" ); } catch { /* gone */ } }
    setTimeout( () => { for ( const target of tree ) { try { process.kill( target, 0 ); process.kill( target, "SIGKILL" ); } catch { /* gone */ } } }, 1500 );
}

/** Whether a pid is still alive (signal 0 probes without killing). */
function alive( pid : number ) : boolean { try { process.kill( pid, 0 ); return true; } catch { return false; } }

/**
 * SIGTERM the whole tree under each root and AWAIT their exit (polling), SIGKILLing any that outlive the
 * timeout. Used on app-quit so local services (and their npm/tsx/node children) are fully down before the
 * console exits — never left orphaned holding ports. Resolves with the number of processes signalled.
 */
export async function killTreesAndWait( rootPids : Array<number>, timeoutMs : number = 5000 ) : Promise<number>
{
    const rows : Array<PsRow> = psTable();
    const tree : Array<number> = [ ...withDescendants( new Set( rootPids ), rows ) ];
    if ( tree.length === 0 ) return 0;

    for ( const target of tree ) { try { process.kill( target, "SIGTERM" ); } catch { /* gone */ } }

    const deadline : number = Date.now() + timeoutMs;
    await new Promise<void>( ( resolve ) =>
    {
        const tick = () : void =>
        {
            const survivors : Array<number> = tree.filter( alive );
            if ( survivors.length === 0 || Date.now() >= deadline )
            {
                for ( const target of survivors ) { try { process.kill( target, "SIGKILL" ); } catch { /* gone */ } }
                resolve();
            }
            else setTimeout( tick, 200 );
        };
        tick();
    } );
    return tree.length;
}

/** Kill every orphan/stale rup process (whole trees). Never touches owned trees or the console's own
 *  ancestry. Returns how many top-level trees were reaped. */
export function reapStale( ownedRoots : Array<number> ) : ReapResult
{
    try
    {
        const rows  : Array<PsRow> = psTable();
        const byPid : Map<number, PsRow> = new Map( rows.map( ( row ) => [ row.pid, row ] ) );
        const owned : Set<number> = withDescendants( new Set( ownedRoots ), rows );
        const guard : Set<number> = ancestorsOf( process.pid, byPid ); guard.add( process.pid );

        const stale : Set<number> = new Set();
        for ( const row of rows )
        {
            if ( !RUP_PATTERN.test( row.command ) ) continue;
            if ( owned.has( row.pid ) || guard.has( row.pid ) ) continue;
            if ( isConsoleOwnCwd( needsCwd( row.command ) ? cwdOf( row.pid ) : undefined ) ) continue;
            stale.add( row.pid );
        }
        // kill only the TOP-MOST stale pids (killProcessTree handles their descendants)
        const tops : Array<number> = [ ...stale ].filter( ( pid ) => !ancestorsOf( pid, byPid ).size || ![ ...ancestorsOf( pid, byPid ) ].some( ( a ) => stale.has( a ) ) );
        for ( const pid of tops ) killProcessTree( pid );
        return { ok: true, killed: tops.length };
    }
    catch ( err ) { return { ok: false, killed: 0, error: ( err as Error ).message }; }
}

/** Kill any ORPHAN (not owned) rup process holding one of `ports` — whole tree, so a stale tsx-watch
 *  parent can't respawn and re-grab the port. Called right before a fresh local run of a service.
 *  Returns the number of trees reaped. */
export function reapOrphansOnPorts( ports : Array<number>, ownedRoots : Array<number> ) : number
{
    if ( ports.length === 0 ) return 0;
    const rows   : Array<PsRow> = psTable();
    const owned  : Set<number> = withDescendants( new Set( ownedRoots ), rows );
    const listen : Map<number, number> = listenerPorts();
    const wanted : Set<number> = new Set( ports );

    const byPid : Map<number, PsRow> = new Map( rows.map( ( r ) => [ r.pid, r ] ) );
    let reaped : number = 0;
    for ( const [ pid, port ] of listen )
    {
        if ( !wanted.has( port ) || owned.has( pid ) ) continue;
        const row : PsRow | undefined = byPid.get( pid );
        if ( !row || !RUP_PATTERN.test( row.command ) ) continue;   // only reclaim from OUR kind of process

        // climb to the dev-tree root so the watcher PARENT dies too (else `tsx watch` just respawns the
        // child and re-grabs the port). Keep climbing while the parent is a dev-script wrapper.
        let root : number = pid;
        for ( let hop = 0; hop < 6; hop++ )
        {
            const parent : number | undefined = byPid.get( root )?.ppid;
            if ( !parent || parent <= 1 ) break;
            const parentCommand : string = byPid.get( parent )?.command ?? "";
            if ( !/npm run dev|tsx watch|turbo run dev|node_modules\/\.bin\/turbo/.test( parentCommand ) ) break;
            root = parent;
        }
        killProcessTree( root );
        reaped++;
    }
    return reaped;
}
