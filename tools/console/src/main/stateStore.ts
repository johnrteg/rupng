import { execFile, execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";

import { DEPLOY_ID, type AuditEntry, type DeployEnvName, type DeployEnvState, type DeployState } from "../shared/types";
import { REPO_ROOT } from "./paths";
import { logStore } from "./logStore";

//
// Deploy state + audit trail (see RELEASE.md → Compliance & Controls).
//
// `environments.json` (env → deployed ref/tag) and `deploy-audit.jsonl` (append-only deploy log) are
// the source of truth for "what's deployed where" and "who deployed what, when". They live on a
// protected "audit" branch (default `main`) so the record is stable no matter which branch a dev is
// on. We never edit the working tree's copy from a feature branch — instead each deploy commits the
// updated state + a new audit line ON the audit branch, via an isolated detached worktree, signed,
// then pushes. Reads come from that branch's tip.
//

const execFileP = promisify( execFile );

const STATE_FILE = "environments.json";
const AUDIT_FILE = "deploy-audit.jsonl";

const EMPTY : DeployState = { dev: { ref: "" }, staging: { ref: "" }, production: { ref: "" } };

const SAY = ( m : string ) : void => logStore.sys( DEPLOY_ID, "deploy", m );

/** Does a git ref resolve? (sync, quiet). */
function hasRef( ref : string ) : boolean
{
    try { execFileSync( "git", [ "rev-parse", "--verify", "--quiet", `${ref}^{commit}` ], { cwd: REPO_ROOT, stdio: "ignore" } ); return true; }
    catch { return false; }
}

/** The protected branch that holds the state + audit files — `main` if it exists, else the current branch. */
export function auditBranch() : string
{
    if ( hasRef( "origin/main" ) || hasRef( "main" ) ) return "main";
    try { return execFileSync( "git", [ "rev-parse", "--abbrev-ref", "HEAD" ], { cwd: REPO_ROOT, encoding: "utf8" } ).trim(); }
    catch { return "main"; }
}

/** Read a file as it exists at the audit branch tip (origin first, then local, then working tree). */
function showFile( file : string ) : string | undefined
{
    const b : string = auditBranch();
    for ( const ref of [ `origin/${b}`, b ] )
    {
        try { return execFileSync( "git", [ "show", `${ref}:${file}` ], { cwd: REPO_ROOT, encoding: "utf8", stdio: [ "ignore", "pipe", "ignore" ] } ); }
        catch { /* not on that ref */ }
    }
    const p : string = join( REPO_ROOT, file );
    return existsSync( p ) ? readFileSync( p, "utf8" ) : undefined;
}

/** Current env → deployed ref/tag pointers. */
export function readState() : DeployState
{
    const text : string | undefined = showFile( STATE_FILE );
    if ( !text ) return EMPTY;
    try
    {
        const parsed = JSON.parse( text ) as Partial<DeployState>;
        return { dev: parsed.dev ?? { ref: "" }, staging: parsed.staging ?? { ref: "" }, production: parsed.production ?? { ref: "" } };
    }
    catch { return EMPTY; }
}

/** The most recent audit entries (newest last), up to `limit`. */
export function readAudit( limit : number = 200 ) : AuditEntry[]
{
    const text : string | undefined = showFile( AUDIT_FILE );
    if ( !text ) return [];
    const lines : string[] = text.split( "\n" ).map( ( l ) => l.trim() ).filter( Boolean );
    const out : AuditEntry[] = [];
    for ( const l of lines.slice( -limit ) )
        try { out.push( JSON.parse( l ) as AuditEntry ); } catch { /* skip malformed */ }
    return out;
}

/** The git identity running the console (for the audit `actor`). */
export function actor() : string
{
    try
    {
        const name : string = execFileSync( "git", [ "config", "user.name" ], { cwd: REPO_ROOT, encoding: "utf8" } ).trim();
        const email : string = execFileSync( "git", [ "config", "user.email" ], { cwd: REPO_ROOT, encoding: "utf8" } ).trim();
        return name ? `${name} <${email}>` : ( email || "unknown" );
    }
    catch { return "unknown"; }
}

/**
 * Record a deploy: set the env pointer in environments.json and append the audit entry to
 * deploy-audit.jsonl, in ONE signed commit on the audit branch, then push. Isolated via a detached
 * worktree so the dev's working branch is untouched. Best-effort + fully logged; sets entry.signed.
 */
export async function recordDeploy( env : DeployEnvName, envState : DeployEnvState, entry : AuditEntry ) : Promise<void>
{
    const branch : string = auditBranch();
    const wt : string = join( tmpdir(), `rupng-audit-${Date.now()}` );
    const base : string = hasRef( `origin/${branch}` ) ? `origin/${branch}` : branch;

    const git = ( args : string[] ) : Promise<{ stdout : string }> => execFileP( "git", args, { cwd: REPO_ROOT, maxBuffer: 16 * 1024 * 1024 } );
    const gitWt = ( args : string[] ) : Promise<{ stdout : string }> => execFileP( "git", args, { cwd: wt, maxBuffer: 16 * 1024 * 1024 } );

    try
    {
        try { await git( [ "fetch", "origin", branch, "--quiet" ] ); } catch { /* offline */ }
        await git( [ "worktree", "add", "--detach", wt, base ] );

        // merge the env pointer + append the audit line (read the branch's current copies in the worktree)
        const statePath : string = join( wt, STATE_FILE );
        const state : DeployState = existsSync( statePath ) ? safeParseState( readFileSync( statePath, "utf8" ) ) : { ...EMPTY };
        state[ env ] = envState;
        writeFileSync( statePath, JSON.stringify( state, null, 2 ) + "\n" );

        const auditPath : string = join( wt, AUDIT_FILE );
        const prior : string = existsSync( auditPath ) ? readFileSync( auditPath, "utf8" ) : "";
        const prefix : string = prior && !prior.endsWith( "\n" ) ? prior + "\n" : prior;

        await gitWt( [ "add", STATE_FILE, AUDIT_FILE ] );
        const msg : string = `audit: ${entry.action} ${entry.tag ?? entry.ref} → ${env} [${entry.result}]`;

        // try a signed commit first; fall back to unsigned and record which we got
        let signed : boolean = true;
        // write the audit line AFTER staging so we control the exact bytes; then add again
        writeFileSync( auditPath, prefix + JSON.stringify( { ...entry, signed: true } ) + "\n" );
        await gitWt( [ "add", AUDIT_FILE ] );
        try { await gitWt( [ "commit", "-S", "-m", msg ] ); }
        catch
        {
            signed = false;
            writeFileSync( auditPath, prefix + JSON.stringify( { ...entry, signed: false } ) + "\n" );
            await gitWt( [ "add", AUDIT_FILE ] );
            await gitWt( [ "commit", "-m", msg ] );
        }

        await gitWt( [ "push", "origin", `HEAD:${branch}` ] );
        SAY( `🗒  audit recorded on ${branch} (${signed ? "signed" : "unsigned — no signing key"}) · pushed` );
    }
    catch ( err )
    {
        SAY( `⚠ could not record audit/state on ${branch}: ${( err as Error ).message}` );
    }
    finally
    {
        try { await git( [ "worktree", "remove", "--force", wt ] ); } catch { /* */ }
    }
}

function safeParseState( text : string ) : DeployState
{
    try { const p = JSON.parse( text ) as Partial<DeployState>; return { dev: p.dev ?? { ref: "" }, staging: p.staging ?? { ref: "" }, production: p.production ?? { ref: "" } }; }
    catch { return { ...EMPTY }; }
}
