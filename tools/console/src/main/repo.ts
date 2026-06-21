import { execFile, execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";

import type { BumpKind, NpmOutdated, RepoArea, RepoAreaKind, RepoStatus, VersionConflict, VersionOccurrence } from "../shared/types";
import { REPO_ID } from "../shared/types";
import { REPO_ROOT } from "./paths";
import { logStore } from "./logStore";
import { processManager } from "./processManager";

//
// Repo operations for the Repo tab: read git status grouped by workspace area (service/package/…),
// bump package versions, and run the git/npm lifecycle (pull, reinstall, test, open a PR) as streamed
// processes under the "repo" log slot. Read-only git queries use execFileSync; long-running commands
// go through the process manager so their output streams to the Repo console.
//

function git( args : string[] ) : string
{
    return execFileSync( "git", args, { cwd: REPO_ROOT, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 } );
}

function currentBranch() : string { return git( [ "rev-parse", "--abbrev-ref", "HEAD" ] ).trim(); }

/** Local + remote branches (origin/ stripped, de-duped, current first) — for the pull/push selectors. */
export function branches() : import("../shared/types").RepoBranches
{
    try
    {
        const cur : string = currentBranch();
        const raw : string[] = git( [ "branch", "-a", "--format=%(refname:short)" ] ).split( "\n" ).map( ( s ) => s.trim() ).filter( Boolean );
        const names : Set<string> = new Set();
        for ( const r of raw )
        {
            if ( r.startsWith( "origin/" ) ) { if ( r !== "origin/HEAD" ) names.add( r.slice( "origin/".length ) ); }
            else names.add( r );
        }
        const list : string[] = [ ...names ].filter( ( b ) => b !== cur ).sort();
        return { current: cur, branches: [ cur, ...list ] };
    }
    catch { return { current: "?", branches: [] }; }
}

/** Map a repo-relative file path to the workspace area that owns it. */
function areaFor( file : string ) : { path : string; name : string; kind : RepoAreaKind }
{
    const parts : string[] = file.split( "/" );
    if ( file.startsWith( "apps/" ) && parts.length >= 3 )      return { path: parts.slice( 0, 3 ).join( "/" ), name: parts[ 2 ], kind: "service" };
    if ( file.startsWith( "packages/" ) && parts.length >= 2 )  return { path: `packages/${parts[ 1 ]}`, name: parts[ 1 ], kind: "package" };
    if ( file.startsWith( "cloud/" ) )                          return { path: "cloud", name: "cloud", kind: "cloud" };
    if ( file.startsWith( "tools/console/" ) )                  return { path: "tools/console", name: "console", kind: "console" };
    return { path: ".", name: "(root)", kind: "root" };
}

function versionAt( areaPath : string ) : string | undefined
{
    const p : string = join( REPO_ROOT, areaPath, "package.json" );
    if ( !existsSync( p ) ) return undefined;
    try { return ( JSON.parse( readFileSync( p, "utf8" ) ) as { version? : string } ).version; }
    catch { return undefined; }
}

/** git status grouped by area, with change counts, versions, branch, and any merge conflicts. */
export function repoStatus() : RepoStatus
{
    try
    {
        const branch : string = git( [ "rev-parse", "--abbrev-ref", "HEAD" ] ).trim();
        const porcelain : string[] = git( [ "status", "--porcelain" ] ).split( "\n" ).filter( Boolean );
        const conflicts : string[] = git( [ "diff", "--name-only", "--diff-filter=U" ] ).split( "\n" ).filter( Boolean );

        const grouped : Map<string, RepoArea> = new Map();
        for ( const line of porcelain )
        {
            let file : string = line.slice( 3 );
            const arrow : number = file.indexOf( " -> " );        // renames: "old -> new"
            if ( arrow >= 0 ) file = file.slice( arrow + 4 );
            file = file.replace( /^"|"$/g, "" );
            const a = areaFor( file );
            const existing : RepoArea | undefined = grouped.get( a.path );
            if ( existing ) { existing.changed += 1; existing.files.push( file ); }
            else grouped.set( a.path, { path: a.path, name: a.name, kind: a.kind, changed: 1, files: [ file ],
                                        version: versionAt( a.path ), deleted: !existsSync( join( REPO_ROOT, a.path ) ) } );
        }

        const areas : RepoArea[] = [ ...grouped.values() ].sort( ( x, y ) => x.path.localeCompare( y.path ) );

        return { branch, areas, conflicts, clean: porcelain.length === 0 };
    }
    catch ( err ) { return { branch: "?", areas: [], conflicts: [], clean: true, error: ( err as Error ).message }; }
}

/** Bump an area's package.json version (semver core x.y.z). Returns the new version. */
export function bumpVersion( areaPath : string, kind : BumpKind ) : { ok : boolean; version? : string; error? : string }
{
    const p : string = join( REPO_ROOT, areaPath, "package.json" );
    if ( !existsSync( p ) ) return { ok: false, error: "no package.json in this area" };
    try
    {
        const pkg = JSON.parse( readFileSync( p, "utf8" ) ) as { version? : string };
        const cur : string = pkg.version ?? "0.0.0";
        const m : RegExpMatchArray | null = cur.match( /^(\d+)\.(\d+)\.(\d+)(.*)$/ );
        if ( !m ) return { ok: false, error: `unparseable version "${cur}"` };
        let [ maj, min, pat ] : number[] = [ Number( m[ 1 ] ), Number( m[ 2 ] ), Number( m[ 3 ] ) ];
        if ( kind === "major" ) { maj += 1; min = 0; pat = 0; }
        else if ( kind === "minor" ) { min += 1; pat = 0; }
        else pat += 1;
        const next : string = `${maj}.${min}.${pat}`;
        pkg.version = next;
        writeFileSync( p, JSON.stringify( pkg, null, 4 ) + "\n" );
        logStore.sys( REPO_ID, "runtime", `⇧ ${areaPath}: ${cur} → ${next}` );
        return { ok: true, version: next };
    }
    catch ( err ) { return { ok: false, error: ( err as Error ).message }; }
}

// ── streamed lifecycle (output → the "repo" console) ──────────────────────────────────────────────

/**
 * `git pull`. If a plain merge can't fast-forward (local changes or divergent history), retry with
 * rebase + autostash — git stashes your working changes, rebases the remote in, then reapplies them.
 * Any leftover conflicts surface in the next repoStatus() (→ the Claude resolver). We log the switch
 * so the user knows the stash/rebase/reapply is happening.
 */
export async function pull( branch? : string ) : Promise<number>
{
    // pull a specific branch from origin, or the tracked upstream of the current branch
    const from : string[] = branch && branch !== currentBranch() ? [ "origin", branch ] : [];
    if ( from.length ) logStore.sys( REPO_ID, "runtime", `pulling origin/${branch} into ${currentBranch()}…` );

    const code : number = await processManager.exec( REPO_ID, "runtime", "git", [ "pull", "--no-edit", ...from ], REPO_ROOT );
    if ( code === 0 ) return 0;

    logStore.sys( REPO_ID, "runtime",
        "⚠ plain pull couldn't merge cleanly (local changes or divergent history). " +
        "Retrying with rebase + autostash — stashing your changes, rebasing the remote in, then reapplying them…" );
    return processManager.exec( REPO_ID, "runtime", "git", [ "pull", "--rebase", "--autostash", ...from ], REPO_ROOT );
}

/** Delete every node_modules across the workspaces, then `npm install` + `npm run build`. */
export async function reinstall() : Promise<number>
{
    logStore.sys( REPO_ID, "runtime", "■ removing node_modules across the workspace…" );
    let removed : number = 0;
    for ( const dir of nodeModulesDirs() )
    {
        try { rmSync( dir, { recursive: true, force: true } ); removed += 1; logStore.sys( REPO_ID, "runtime", `  ✖ ${dir.replace( REPO_ROOT, "." )}` ); }
        catch { /* ignore */ }
    }
    logStore.sys( REPO_ID, "runtime", `removed ${removed} node_modules dir(s) — installing…` );
    const install : number = await processManager.exec( REPO_ID, "runtime", "npm", [ "install" ], REPO_ROOT );
    if ( install !== 0 ) return install;
    return processManager.exec( REPO_ID, "runtime", "npm", [ "run", "build" ], REPO_ROOT );
}

/**
 * `npm outdated` across the workspaces — installed vs available. Async (hits the registry, can be
 * slow). npm exits 1 when anything is outdated but still prints JSON to stdout, so we parse stdout
 * regardless of exit code. Each package may have one entry or several (one per dependent).
 */
export function npmOutdated() : Promise<{ deps : NpmOutdated[]; error? : string }>
{
    return new Promise( ( resolve ) =>
    {
        execFile( "npm", [ "outdated", "--json", "-l" ], { cwd: REPO_ROOT, maxBuffer: 32 * 1024 * 1024 }, ( _err, stdout ) =>
        {
            const text : string = ( stdout ?? "" ).toString().trim();
            if ( text === "" ) { resolve( { deps: [] } ); return; }
            try
            {
                const json = JSON.parse( text ) as Record<string, unknown>;
                const deps : NpmOutdated[] = [];
                for ( const [ name, info ] of Object.entries( json ) )
                    for ( const e of ( Array.isArray( info ) ? info : [ info ] ) as Array<Record<string, string>> )
                        deps.push( { name, current: e.current ?? "—", wanted: e.wanted ?? "", latest: e.latest ?? "", dependent: e.dependent ?? "" } );
                deps.sort( ( a, b ) => a.name.localeCompare( b.name ) );
                resolve( { deps } );
            }
            catch ( err ) { resolve( { deps: [], error: ( err as Error ).message } ); }
        } );
    } );
}

// ── cross-workspace version reconciliation (Sync Version) ─────────────────────────────────────────

function isSemver( v : string ) : boolean { return /^\d+\.\d+\.\d+/.test( v ); }
function semverCmp( a : string, b : string ) : number
{
    const pa = a.match( /(\d+)\.(\d+)\.(\d+)/ ), pb = b.match( /(\d+)\.(\d+)\.(\d+)/ );
    if ( !pa || !pb ) return 0;
    for ( let i = 1; i <= 3; i++ ) { const d : number = Number( pa[ i ] ) - Number( pb[ i ] ); if ( d !== 0 ) return d; }
    return 0;
}
function newestOf( versions : string[] ) : string { return versions.filter( isSemver ).reduce( ( a, b ) => ( semverCmp( a, b ) >= 0 ? a : b ) ); }

/** Every workspace package.json (root, cloud, each tools, packages and apps subdir). */
function packageFiles() : string[] {
    const files : string[] = [];
    const add = ( dir : string ) : void => { const p = join( dir, "package.json" ); if ( existsSync( p ) ) files.push( p ); };
    add( REPO_ROOT );
    add( join( REPO_ROOT, "cloud" ) );
    for ( const t of safeDirs( join( REPO_ROOT, "tools" ) ) ) add( t );
    for ( const p of safeDirs( join( REPO_ROOT, "packages" ) ) ) add( p );
    for ( const grp of safeDirs( join( REPO_ROOT, "apps" ) ) ) for ( const svc of safeDirs( grp ) ) add( svc );
    return files;
}

/** name → its occurrences (area + version + dev) across every package.json. */
function scanDeps() : Map<string, VersionOccurrence[]> {
    const map : Map<string, VersionOccurrence[]> = new Map();
    for ( const file of packageFiles() )
    {
        const area : string = relative( REPO_ROOT, dirname( file ) ) || ".";
        let pkg : Record<string, Record<string, string>>;
        try { pkg = JSON.parse( readFileSync( file, "utf8" ) ); } catch { continue; }
        for ( const [ block, dev ] of [ [ "dependencies", false ], [ "devDependencies", true ] ] as const )
            for ( const [ name, version ] of Object.entries( pkg[ block ] ?? {} ) )
            {
                if ( typeof version !== "string" || !isSemver( version ) ) continue;
                const arr : VersionOccurrence[] = map.get( name ) ?? [];
                arr.push( { area, version, dev } );
                map.set( name, arr );
            }
    }
    return map;
}

/** Libraries declared at more than one version across the workspaces (newest = the sync target). */
export function versionConflicts() : { conflicts : VersionConflict[]; error? : string } {
    try
    {
        const map : Map<string, VersionOccurrence[]> = scanDeps();
        const conflicts : VersionConflict[] = [];
        for ( const [ name, occ ] of map )
        {
            const distinctVersions : Set<string> = new Set( occ.map( ( o ) => o.version ) );
            const distinctAreas : Set<string> = new Set( occ.map( ( o ) => o.area ) );
            // only libraries used in MORE THAN ONE package, and not already on the same version
            if ( distinctAreas.size > 1 && distinctVersions.size > 1 )
                conflicts.push( { name, newest: newestOf( occ.map( ( o ) => o.version ) ), occurrences: occ.sort( ( a, b ) => semverCmp( a.version, b.version ) ) } );
        }
        conflicts.sort( ( a, b ) => a.name.localeCompare( b.name ) );
        return { conflicts };
    }
    catch ( err ) { return { conflicts: [], error: ( err as Error ).message }; }
}

/** Set a dependency's version in one package.json (raw-text edit, preserves formatting). */
function setDepVersion( file : string, name : string, version : string ) : boolean {
    const text : string = readFileSync( file, "utf8" );
    const esc : string = name.replace( /[.*+?^${}()|[\]\\]/g, "\\$&" );
    const re = new RegExp( `("${esc}"\\s*:\\s*")[^"]*(")`, "g" );
    const next : string = text.replace( re, `$1${version}$2` );
    if ( next === text ) return false;
    writeFileSync( file, next );
    return true;
}

/** Align each named library to its newest version across all package.json, then `npm install`. */
export async function syncVersions( names : string[] ) : Promise<number> {
    const map : Map<string, VersionOccurrence[]> = scanDeps();
    let changed : number = 0;
    for ( const name of names )
    {
        const occ : VersionOccurrence[] | undefined = map.get( name );
        if ( !occ || occ.length === 0 ) continue;
        const newest : string = newestOf( occ.map( ( o ) => o.version ) );
        for ( const file of packageFiles() )
        {
            const area : string = relative( REPO_ROOT, dirname( file ) ) || ".";
            if ( occ.some( ( o ) => o.area === area && o.version !== newest ) && setDepVersion( file, name, newest ) )
            { changed += 1; logStore.sys( REPO_ID, "runtime", `⇧ ${area}: ${name} → ${newest}` ); }
        }
    }
    if ( changed === 0 ) { logStore.sys( REPO_ID, "runtime", "nothing to sync — versions already aligned" ); return 0; }
    logStore.sys( REPO_ID, "runtime", `aligned ${changed} dependency declaration(s) — wiping node_modules, reinstalling + rebuilding…` );
    return reinstall();
}

/**
 * Update the named packages to their latest version, then clean-reinstall + rebuild.
 *
 * We write `latest` straight into whichever package.json DECLARES the dep (a dep is usually owned by
 * a workspace like packages/services, not the root — so `npm install pkg@latest` at the root is a
 * no-op against a pinned workspace version). Then `reinstall()` installs the new versions.
 */
export async function updateDeps( names : string[] ) : Promise<number>
{
    if ( names.length > 0 )
    {
        const { deps } = await npmOutdated();
        const latest : Map<string, string> = new Map( deps.map( ( d ) => [ d.name, d.latest ] ) );
        let changed : number = 0;
        for ( const file of packageFiles() )
        {
            const area : string = relative( REPO_ROOT, dirname( file ) ) || ".";
            for ( const name of names )
            {
                const v : string | undefined = latest.get( name );
                if ( v && isSemver( v ) && setDepVersion( file, name, v ) )
                { changed += 1; logStore.sys( REPO_ID, "runtime", `⇧ ${area}: ${name} → ${v}` ); }
            }
        }
        logStore.sys( REPO_ID, "runtime", `updated ${changed} dependency declaration(s) to latest — reinstalling…` );
    }
    return reinstall();
}

/**
 * Run unit tests once (vitest run). With area paths → just those areas' tests (per-area); empty →
 * the whole repo (all). `--passWithNoTests` so an impacted area without tests doesn't fail the gate.
 */
export function test( areas : string[] = [] ) : Promise<number>
{
    if ( areas.length === 0 )
        return processManager.exec( REPO_ID, "runtime", "npm", [ "test", "--", "--run", "--passWithNoTests" ], REPO_ROOT );
    return processManager.exec( REPO_ID, "runtime", "npx", [ "vitest", "run", "--passWithNoTests", ...areas ], REPO_ROOT );
}

/**
 * Stage ONLY the selected area paths (so the commit is scoped to what was checked), commit on the
 * CURRENT branch, and push to the target branch's ref on origin (`HEAD:<branch>` — creates it if new).
 * We don't `git checkout` the target: that fails on a dirty tree. Committing where you are and
 * pushing to the chosen ref is safe and needs no clean working tree.
 */
export async function commitPush( branch : string, message : string, paths : string[] = [] ) : Promise<number>
{
    const cur : string = currentBranch();
    const add : string[] = paths.length > 0 ? [ "add", "--", ...paths ] : [ "add", "-A" ];
    logStore.sys( REPO_ID, "runtime", `staging: ${paths.length > 0 ? paths.join( ", " ) : "all changes"}` );
    if ( await processManager.exec( REPO_ID, "runtime", "git", add, REPO_ROOT ) !== 0 ) return 1;
    if ( await processManager.exec( REPO_ID, "runtime", "git", [ "commit", "-m", message ], REPO_ROOT ) !== 0 ) return 1;

    const cross : boolean = !!branch && branch !== cur;
    if ( cross ) logStore.sys( REPO_ID, "runtime", `pushing ${cur} → origin/${branch}` );
    const push : string[] = cross ? [ "push", "origin", `HEAD:${branch}` ] : [ "push", "-u", "origin", "HEAD" ];
    return processManager.exec( REPO_ID, "runtime", "git", push, REPO_ROOT );
}

/** Commit + push the selected paths, then open a PR (head = the pushed branch) via the GitHub CLI. */
export async function createPR( branch : string, title : string, paths : string[] = [] ) : Promise<number>
{
    const cur : string = currentBranch();
    const code : number = await commitPush( branch, title, paths );
    if ( code !== 0 ) return code;
    const head : string[] = branch && branch !== cur ? [ "--head", branch ] : [];
    return processManager.exec( REPO_ID, "runtime", "gh", [ "pr", "create", "--fill", "--title", title, ...head ], REPO_ROOT );
}

/** Locate node_modules dirs at the root + each workspace (one level deep — not nested ones). */
function nodeModulesDirs() : string[]
{
    // NOTE: deliberately excludes tools/* (the console itself) — it isn't a root workspace, so a root
    // `npm install` wouldn't restore it, and wiping the running app's own deps is self-destructive.
    const out : string[] = [];
    const add = ( dir : string ) : void => { const nm = join( dir, "node_modules" ); if ( existsSync( nm ) ) out.push( nm ); };
    add( REPO_ROOT );
    add( join( REPO_ROOT, "cloud" ) );
    for ( const p of safeDirs( join( REPO_ROOT, "packages" ) ) ) add( p );
    for ( const grp of safeDirs( join( REPO_ROOT, "apps" ) ) ) for ( const svc of safeDirs( grp ) ) add( svc );
    return out;
}

function safeDirs( parent : string ) : string[]
{
    if ( !existsSync( parent ) ) return [];
    try { return readdirSync( parent ).map( ( n ) => join( parent, n ) ).filter( ( p ) => statSync( p ).isDirectory() ); }
    catch { return []; }
}
