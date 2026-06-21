import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { BumpKind, RepoArea, RepoAreaKind, RepoStatus } from "../shared/types";
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

function localBranchExists( branch : string ) : boolean
{
    try { git( [ "rev-parse", "--verify", "--quiet", `refs/heads/${branch}` ] ); return true; }
    catch { return false; }
}

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
            if ( existing ) existing.changed += 1;
            else grouped.set( a.path, { path: a.path, name: a.name, kind: a.kind, changed: 1,
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
 * Run unit tests once (vitest run). With area paths → just those areas' tests (per-area); empty →
 * the whole repo (all). `--passWithNoTests` so an impacted area without tests doesn't fail the gate.
 */
export function test( areas : string[] = [] ) : Promise<number>
{
    if ( areas.length === 0 )
        return processManager.exec( REPO_ID, "runtime", "npm", [ "test", "--", "--run", "--passWithNoTests" ], REPO_ROOT );
    return processManager.exec( REPO_ID, "runtime", "npx", [ "vitest", "run", "--passWithNoTests", ...areas ], REPO_ROOT );
}

/** Switch to `branch` (creating it from the current branch if new), stage everything, commit, push. */
export async function commitPush( branch : string, message : string ) : Promise<number>
{
    if ( branch && branch !== currentBranch() )
    {
        const exists : boolean = localBranchExists( branch );
        logStore.sys( REPO_ID, "runtime", `switching to ${branch}${exists ? "" : " (new branch)"}…` );
        const co : number = await processManager.exec( REPO_ID, "runtime", "git", exists ? [ "checkout", branch ] : [ "checkout", "-b", branch ], REPO_ROOT );
        if ( co !== 0 ) return co;
    }
    if ( await processManager.exec( REPO_ID, "runtime", "git", [ "add", "-A" ], REPO_ROOT ) !== 0 ) return 1;
    if ( await processManager.exec( REPO_ID, "runtime", "git", [ "commit", "-m", message ], REPO_ROOT ) !== 0 ) return 1;
    return processManager.exec( REPO_ID, "runtime", "git", [ "push", "-u", "origin", branch || "HEAD" ], REPO_ROOT );
}

/** Commit + push to `branch`, then open a PR via the GitHub CLI. Renderer gates on passing tests. */
export async function createPR( branch : string, title : string ) : Promise<number>
{
    const code : number = await commitPush( branch, title );
    if ( code !== 0 ) return code;
    return processManager.exec( REPO_ID, "runtime", "gh", [ "pr", "create", "--fill", "--title", title ], REPO_ROOT );
}

/** Locate node_modules dirs at the root + each workspace (one level deep — not nested ones). */
function nodeModulesDirs() : string[]
{
    const out : string[] = [];
    const add = ( dir : string ) : void => { const nm = join( dir, "node_modules" ); if ( existsSync( nm ) ) out.push( nm ); };
    add( REPO_ROOT );
    add( join( REPO_ROOT, "cloud" ) );
    for ( const t of safeDirs( join( REPO_ROOT, "tools" ) ) ) add( t );
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
