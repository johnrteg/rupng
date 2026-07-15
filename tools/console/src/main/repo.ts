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

/** Run a git command synchronously in the repo root and return its stdout. */
function git( args : Array<string> ) : string
{
    return execFileSync( "git", args, { cwd: REPO_ROOT, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 } );
}

/** The name of the currently checked-out branch. */
function currentBranch() : string { return git( [ "rev-parse", "--abbrev-ref", "HEAD" ] ).trim(); }

/** Local + remote branches (origin/ stripped, de-duped, current first) — for the pull/push selectors. */
export function branches() : import("../shared/types").RepoBranches
{
    try
    {
        const current : string = currentBranch();
        const rawBranches : Array<string> = git( [ "branch", "-a", "--format=%(refname:short)" ] ).split( "\n" ).map( ( line ) => line.trim() ).filter( Boolean );
        const names : Set<string> = new Set();
        for ( const branchName of rawBranches )
        {
            // collapse origin/<x> down to <x> (and drop the origin/HEAD pointer) so local + remote de-dupe
            if ( branchName.startsWith( "origin/" ) ) { if ( branchName !== "origin/HEAD" ) names.add( branchName.slice( "origin/".length ) ); }
            else names.add( branchName );
        }
        const others : Array<string> = [ ...names ].filter( ( name ) => name !== current ).sort();
        return { current, branches: [ current, ...others ] };
    }
    catch { return { current: "?", branches: [] }; }
}

/** Map a repo-relative file path to the workspace area that owns it. */
function areaFor( file : string ) : { path : string; name : string; kind : RepoAreaKind }
{
    const parts : Array<string> = file.split( "/" );
    if ( file.startsWith( "apps/" ) && parts.length >= 3 )      return { path: parts.slice( 0, 3 ).join( "/" ), name: parts[ 2 ], kind: "service" };
    if ( file.startsWith( "packages/" ) && parts.length >= 2 )  return { path: `packages/${parts[ 1 ]}`, name: parts[ 1 ], kind: "package" };
    if ( file.startsWith( "cloud/" ) )                          return { path: "cloud", name: "cloud", kind: "cloud" };
    if ( file.startsWith( "tools/console/" ) )                  return { path: "tools/console", name: "console", kind: "console" };
    return { path: ".", name: "(root)", kind: "root" };
}

/** The version declared in an area's package.json, or undefined if there's none / it's unreadable. */
function versionAt( areaPath : string ) : string | undefined
{
    const packageJsonPath : string = join( REPO_ROOT, areaPath, "package.json" );
    if ( !existsSync( packageJsonPath ) ) return undefined;
    try { return ( JSON.parse( readFileSync( packageJsonPath, "utf8" ) ) as { version? : string } ).version; }
    catch { return undefined; }
}

/** git status grouped by area, with change counts, versions, branch, and any merge conflicts. */
export function repoStatus() : RepoStatus
{
    try
    {
        const branch : string = git( [ "rev-parse", "--abbrev-ref", "HEAD" ] ).trim();
        const porcelain : Array<string> = git( [ "status", "--porcelain" ] ).split( "\n" ).filter( Boolean );
        const conflicts : Array<string> = git( [ "diff", "--name-only", "--diff-filter=U" ] ).split( "\n" ).filter( Boolean );

        const grouped : Map<string, RepoArea> = new Map();
        for ( const line of porcelain )
        {
            let file : string = line.slice( 3 );
            const arrow : number = file.indexOf( " -> " );        // renames: "old -> new"
            if ( arrow >= 0 ) file = file.slice( arrow + 4 );
            file = file.replace( /^"|"$/g, "" );
            const area = areaFor( file );
            const existing : RepoArea | undefined = grouped.get( area.path );
            if ( existing ) { existing.changed += 1; existing.files.push( file ); }
            else grouped.set( area.path, { path: area.path, name: area.name, kind: area.kind, changed: 1, files: [ file ],
                                        version: versionAt( area.path ), deleted: !existsSync( join( REPO_ROOT, area.path ) ) } );
        }

        const areas : Array<RepoArea> = [ ...grouped.values() ].sort( ( left, right ) => left.path.localeCompare( right.path ) );

        return { branch, areas, conflicts, clean: porcelain.length === 0 };
    }
    catch ( err ) { return { branch: "?", areas: [], conflicts: [], clean: true, error: ( err as Error ).message }; }
}

/** Bump an area's package.json version (semver core x.y.z). Returns the new version. */
export function bumpVersion( areaPath : string, kind : BumpKind ) : { ok : boolean; version? : string; error? : string }
{
    const packageJsonPath : string = join( REPO_ROOT, areaPath, "package.json" );
    if ( !existsSync( packageJsonPath ) ) return { ok: false, error: "no package.json in this area" };
    try
    {
        const pkg = JSON.parse( readFileSync( packageJsonPath, "utf8" ) ) as { version? : string };
        const current : string = pkg.version ?? "0.0.0";
        const match : RegExpMatchArray | null = current.match( /^(\d+)\.(\d+)\.(\d+)(.*)$/ );
        if ( !match ) return { ok: false, error: `unparseable version "${current}"` };
        let [ major, minor, patch ] : Array<number> = [ Number( match[ 1 ] ), Number( match[ 2 ] ), Number( match[ 3 ] ) ];
        if ( kind === "major" ) { major += 1; minor = 0; patch = 0; }
        else if ( kind === "minor" ) { minor += 1; patch = 0; }
        else patch += 1;
        const next : string = `${major}.${minor}.${patch}`;
        pkg.version = next;
        writeFileSync( packageJsonPath, JSON.stringify( pkg, null, 4 ) + "\n" );
        logStore.sys( REPO_ID, "runtime", `⇧ ${areaPath}: ${current} → ${next}` );
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
    const source : Array<string> = branch && branch !== currentBranch() ? [ "origin", branch ] : [];
    if ( source.length ) logStore.sys( REPO_ID, "runtime", `pulling origin/${branch} into ${currentBranch()}…` );

    const code : number = await processManager.exec( REPO_ID, "runtime", "git", [ "pull", "--no-edit", ...source ], REPO_ROOT );
    if ( code === 0 ) return 0;

    logStore.sys( REPO_ID, "runtime",
        "⚠ plain pull couldn't merge cleanly (local changes or divergent history). " +
        "Retrying with rebase + autostash — stashing your changes, rebasing the remote in, then reapplying them…" );
    return processManager.exec( REPO_ID, "runtime", "git", [ "pull", "--rebase", "--autostash", ...source ], REPO_ROOT );
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
export function npmOutdated() : Promise<{ deps : Array<NpmOutdated>; error? : string }>
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
                const deps : Array<NpmOutdated> = [];
                for ( const [ name, info ] of Object.entries( json ) )
                    // npm reports either a single object or an array (one entry per dependent) — normalize to an array
                    for ( const entry of ( Array.isArray( info ) ? info : [ info ] ) as Array<Record<string, string>> )
                        deps.push( { name, current: entry.current ?? "—", wanted: entry.wanted ?? "", latest: entry.latest ?? "", dependent: entry.dependent ?? "" } );
                deps.sort( ( left, right ) => left.name.localeCompare( right.name ) );
                resolve( { deps } );
            }
            catch ( err ) { resolve( { deps: [], error: ( err as Error ).message } ); }
        } );
    } );
}

// ── cross-workspace version reconciliation (Sync Version) ─────────────────────────────────────────

/** Does the string start with an x.y.z semver core? */
function isSemver( version : string ) : boolean { return /^\d+\.\d+\.\d+/.test( version ); }

/** Compare two semver cores: negative if a < b, positive if a > b, 0 if equal/unparseable. */
function semverCmp( a : string, b : string ) : number
{
    const partsA = a.match( /(\d+)\.(\d+)\.(\d+)/ ), partsB = b.match( /(\d+)\.(\d+)\.(\d+)/ );
    if ( !partsA || !partsB ) return 0;
    for ( let segment = 1; segment <= 3; segment++ ) { const diff : number = Number( partsA[ segment ] ) - Number( partsB[ segment ] ); if ( diff !== 0 ) return diff; }
    return 0;
}

/** The highest semver among the given versions (ignores non-semver entries). */
function newestOf( versions : Array<string> ) : string { return versions.filter( isSemver ).reduce( ( a, b ) => ( semverCmp( a, b ) >= 0 ? a : b ) ); }

/** Every rupng workspace package.json (root, cloud, packages, apps). Excludes tools/* — the console
 *  manages its own deps; the Repo tab must never update/sync the running tool's dependencies. */
function packageFiles() : Array<string> {
    const files : Array<string> = [];
    const add = ( dir : string ) : void => { const packageJsonPath = join( dir, "package.json" ); if ( existsSync( packageJsonPath ) ) files.push( packageJsonPath ); };
    add( REPO_ROOT );
    add( join( REPO_ROOT, "cloud" ) );
    for ( const packageDir of safeDirs( join( REPO_ROOT, "packages" ) ) ) add( packageDir );
    for ( const groupDir of safeDirs( join( REPO_ROOT, "apps" ) ) ) for ( const serviceDir of safeDirs( groupDir ) ) add( serviceDir );
    return files;
}

/** name → its occurrences (area + version + dev) across every package.json. */
function scanDeps() : Map<string, Array<VersionOccurrence>> {
    const map : Map<string, Array<VersionOccurrence>> = new Map();
    for ( const file of packageFiles() )
    {
        const area : string = relative( REPO_ROOT, dirname( file ) ) || ".";
        let pkg : Record<string, Record<string, string>>;
        try { pkg = JSON.parse( readFileSync( file, "utf8" ) ); } catch { continue; }
        for ( const [ block, dev ] of [ [ "dependencies", false ], [ "devDependencies", true ] ] as const )
            for ( const [ name, version ] of Object.entries( pkg[ block ] ?? {} ) )
            {
                if ( typeof version !== "string" || !isSemver( version ) ) continue;
                const occurrences : Array<VersionOccurrence> = map.get( name ) ?? [];
                occurrences.push( { area, version, dev } );
                map.set( name, occurrences );
            }
    }
    return map;
}

/** Libraries declared at more than one version across the workspaces (newest = the sync target). */
export function versionConflicts() : { conflicts : Array<VersionConflict>; error? : string } {
    try
    {
        const map : Map<string, Array<VersionOccurrence>> = scanDeps();
        const conflicts : Array<VersionConflict> = [];
        for ( const [ name, occurrences ] of map )
        {
            const distinctVersions : Set<string> = new Set( occurrences.map( ( occurrence ) => occurrence.version ) );
            const distinctAreas : Set<string> = new Set( occurrences.map( ( occurrence ) => occurrence.area ) );
            // only libraries used in MORE THAN ONE package, and not already on the same version
            if ( distinctAreas.size > 1 && distinctVersions.size > 1 )
                conflicts.push( { name, newest: newestOf( occurrences.map( ( occurrence ) => occurrence.version ) ), occurrences: occurrences.sort( ( left, right ) => semverCmp( left.version, right.version ) ) } );
        }
        conflicts.sort( ( left, right ) => left.name.localeCompare( right.name ) );
        return { conflicts };
    }
    catch ( err ) { return { conflicts: [], error: ( err as Error ).message }; }
}

/** Set a dependency's version in one package.json (raw-text edit, preserves formatting). */
function setDepVersion( file : string, name : string, version : string ) : boolean {
    const text : string = readFileSync( file, "utf8" );
    const escapedName : string = name.replace( /[.*+?^${}()|[\]\\]/g, "\\$&" );
    const declarationPattern = new RegExp( `("${escapedName}"\\s*:\\s*")[^"]*(")`, "g" );
    const next : string = text.replace( declarationPattern, `$1${version}$2` );
    if ( next === text ) return false;
    writeFileSync( file, next );
    return true;
}

/** Align each named library to its newest version across all package.json, then `npm install`. */
export async function syncVersions( names : Array<string> ) : Promise<number> {
    const map : Map<string, Array<VersionOccurrence>> = scanDeps();
    let changed : number = 0;
    for ( const name of names )
    {
        const occurrences : Array<VersionOccurrence> | undefined = map.get( name );
        if ( !occurrences || occurrences.length === 0 ) continue;
        const newest : string = newestOf( occurrences.map( ( occurrence ) => occurrence.version ) );
        for ( const file of packageFiles() )
        {
            const area : string = relative( REPO_ROOT, dirname( file ) ) || ".";
            if ( occurrences.some( ( occurrence ) => occurrence.area === area && occurrence.version !== newest ) && setDepVersion( file, name, newest ) )
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
export async function updateDeps( names : Array<string> ) : Promise<number>
{
    if ( names.length > 0 )
    {
        const { deps } = await npmOutdated();
        const latest : Map<string, string> = new Map( deps.map( ( dep ) => [ dep.name, dep.latest ] ) );
        let changed : number = 0;
        for ( const file of packageFiles() )
        {
            const area : string = relative( REPO_ROOT, dirname( file ) ) || ".";
            for ( const name of names )
            {
                const latestVersion : string | undefined = latest.get( name );
                if ( latestVersion && isSemver( latestVersion ) && setDepVersion( file, name, latestVersion ) )
                { changed += 1; logStore.sys( REPO_ID, "runtime", `⇧ ${area}: ${name} → ${latestVersion}` ); }
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
export function test( areas : Array<string> = [] ) : Promise<number>
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
export async function commitPush( branch : string, message : string, paths : Array<string> = [] ) : Promise<number>
{
    const current : string = currentBranch();
    const addArgs : Array<string> = paths.length > 0 ? [ "add", "--", ...paths ] : [ "add", "-A" ];
    logStore.sys( REPO_ID, "runtime", `staging: ${paths.length > 0 ? paths.join( ", " ) : "all changes"}` );
    if ( await processManager.exec( REPO_ID, "runtime", "git", addArgs, REPO_ROOT ) !== 0 ) return 1;
    if ( await processManager.exec( REPO_ID, "runtime", "git", [ "commit", "-m", message ], REPO_ROOT ) !== 0 ) return 1;

    // pushing to a different branch than the one checked out → push HEAD to that ref (creates it if new)
    const crossBranch : boolean = !!branch && branch !== current;
    if ( crossBranch ) logStore.sys( REPO_ID, "runtime", `pushing ${current} → origin/${branch}` );
    const pushArgs : Array<string> = crossBranch ? [ "push", "origin", `HEAD:${branch}` ] : [ "push", "-u", "origin", "HEAD" ];
    return processManager.exec( REPO_ID, "runtime", "git", pushArgs, REPO_ROOT );
}

/** Commit + push the selected paths, then open a PR (head = the pushed branch) via the GitHub CLI. */
export async function createPR( branch : string, title : string, paths : Array<string> = [] ) : Promise<number>
{
    const current : string = currentBranch();
    const code : number = await commitPush( branch, title, paths );
    if ( code !== 0 ) return code;
    const headArgs : Array<string> = branch && branch !== current ? [ "--head", branch ] : [];
    return processManager.exec( REPO_ID, "runtime", "gh", [ "pr", "create", "--fill", "--title", title, ...headArgs ], REPO_ROOT );
}

/** Locate node_modules dirs at the root + each workspace (one level deep — not nested ones). */
function nodeModulesDirs() : Array<string>
{
    // NOTE: deliberately excludes tools/* (the console itself) — it isn't a root workspace, so a root
    // `npm install` wouldn't restore it, and wiping the running app's own deps is self-destructive.
    const dirs : Array<string> = [];
    const add = ( dir : string ) : void => { const nodeModules = join( dir, "node_modules" ); if ( existsSync( nodeModules ) ) dirs.push( nodeModules ); };
    add( REPO_ROOT );
    add( join( REPO_ROOT, "cloud" ) );
    for ( const packageDir of safeDirs( join( REPO_ROOT, "packages" ) ) ) add( packageDir );
    for ( const groupDir of safeDirs( join( REPO_ROOT, "apps" ) ) ) for ( const serviceDir of safeDirs( groupDir ) ) add( serviceDir );
    return dirs;
}

/** Immediate subdirectories of `parent` as absolute paths. [] if `parent` is missing/unreadable. */
function safeDirs( parent : string ) : Array<string>
{
    if ( !existsSync( parent ) ) return [];
    try { return readdirSync( parent ).map( ( name ) => join( parent, name ) ).filter( ( path ) => statSync( path ).isDirectory() ); }
    catch { return []; }
}
