import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { ApiGatewayV2Client, GetApisCommand, GetRoutesCommand } from "@aws-sdk/client-apigatewayv2";
import { fromIni } from "@aws-sdk/credential-providers";

import { DEPLOY_ID, DEPLOY_ENVS, type AuditAction, type AuditEntry, type DeployEnvConfig, type DeployEnvName, type DeployEnvState, type DeployMap, type DeployRequest, type DeployResult, type DeployState } from "../shared/types";
import { REPO_ROOT } from "./paths";
import { logStore } from "./logStore";
import { processManager } from "./processManager";
import { listServices } from "./registry";
import { actor, readAudit, readState, recordDeploy } from "./stateStore";

//
// Deploy git → a real AWS environment. The console only ever deploys LOCAL code to LocalStack (the
// per-service pipeline); promoting committed code to dev/staging/production is this deliberate,
// separate flow:
//
//   1. check the chosen git ref out into an isolated worktree (committed code, never the dirty tree)
//   2. npm ci + turbo build (web needs bin/ for the S3 upload; ECS images are built inside Docker by
//      the CDK asset bundler, so they don't need a host pre-build)
//   3. `cdk diff|deploy <svc>-<env> --profile <p>` from the worktree's cloud/ — CDK builds + pushes
//      the container images to ECR and applies CloudFormation
//   4. remove the worktree
//
// Everything streams to the (DEPLOY_ID, "deploy") log slot so the Deploy console + Claude can see it.
// cdk runs NON-INTERACTIVELY (`--require-approval never`) — it would otherwise hang on a prompt — so
// production safety lives in the UI (a mandatory diff preview + a typed-name confirmation).
//

function git( args : string[] ) : string
{
    return execFileSync( "git", args, { cwd: REPO_ROOT, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 } );
}

const SAY = ( msg : string ) : void => logStore.sys( DEPLOY_ID, "deploy", msg );

/** Local branches + remote branches (origin/ stripped) + tags + current — for the ref picker. */
export function deployRefs() : { branches : string[]; tags : string[]; current : string }
{
    try
    {
        const current : string = git( [ "rev-parse", "--abbrev-ref", "HEAD" ] ).trim();
        const raw : string[] = git( [ "branch", "-a", "--format=%(refname:short)" ] ).split( "\n" ).map( ( s ) => s.trim() ).filter( Boolean );
        const names : Set<string> = new Set();
        for ( const r of raw )
        {
            if ( r.startsWith( "origin/" ) ) { if ( r !== "origin/HEAD" ) names.add( r.slice( "origin/".length ) ); }
            else names.add( r );
        }
        const branches : string[] = [ current, ...[ ...names ].filter( ( b ) => b !== current ).sort() ];
        const tags : string[] = git( [ "tag", "--sort=-creatordate" ] ).split( "\n" ).map( ( s ) => s.trim() ).filter( Boolean );
        return { branches, tags, current };
    }
    catch { return { branches: [], tags: [], current: "?" }; }
}

/** package.json version of each given service id, read AT a git ref (not the working tree). */
export function gitVersions( ref : string, services : string[] ) : Record<string, string>
{
    // resolve the same way a deploy would (branch → origin/<ref>) so the preview matches what ships.
    // Note: reads the LAST-FETCHED remote tip — hit Refresh (or run a deploy, which fetches) to update.
    const resolved : string = resolveRef( ref );
    const out : Record<string, string> = {};
    for ( const svc of services )
    {
        try
        {
            const text : string = git( [ "show", `${resolved}:apps/core/${svc}/package.json` ] );
            const v : string | undefined = ( JSON.parse( text ) as { version? : string } ).version;
            if ( v ) out[ svc ] = v;
        }
        catch { /* file not present at that ref → omit */ }
    }
    return out;
}

/**
 * Read the LIVE version of each deployed service in an environment. Each service has its own public
 * API Gateway with a /version route (declared in its manifest); we enumerate the env account's HTTP
 * APIs, find the ones exposing GET /version, fetch it, and key the result by the service id the
 * endpoint reports. Uses the env's named profile directly (independent of the Monitor target).
 */
export async function deployedVersions( config : DeployEnvConfig ) : Promise<{ deployed : Record<string, string>; error? : string }>
{
    if ( !config.profile.trim() ) return { deployed: {}, error: "no AWS profile set for this environment" };

    const deployed : Record<string, string> = {};
    let firstError : string | undefined;
    try
    {
        const gw : ApiGatewayV2Client = new ApiGatewayV2Client( { region: config.region, credentials: fromIni( { profile: config.profile } ), maxAttempts: 2 } );
        const { Items: apis = [] } = await gw.send( new GetApisCommand( {} ) );

        for ( const a of apis )
        {
            const apiId : string = a.ApiId ?? "";
            const base : string = a.ApiEndpoint ?? "";
            if ( !apiId || !base ) continue;

            const { Items: routes = [] } = await gw.send( new GetRoutesCommand( { ApiId: apiId } ) );
            const hasVersion : boolean = routes.some( ( r ) => ( r.RouteKey ?? "" ).replace( /\s+/g, " " ).trim().toUpperCase() === "GET /VERSION" );
            if ( !hasVersion ) continue;

            try
            {
                const res = await fetchJson( base.replace( /\/+$/, "" ) + "/version" );
                if ( res && typeof res.service === "string" && typeof res.version === "string" )
                    deployed[ res.service ] = res.version;
            }
            catch ( err ) { firstError ??= `${base}/version unreachable: ${( err as Error ).message}`; }
        }
        return { deployed, error: Object.keys( deployed ).length === 0 ? ( firstError ?? "no deployed /version routes found in this account" ) : undefined };
    }
    catch ( err ) { return { deployed, error: `discovery failed: ${( err as Error ).message}` }; }
}

async function fetchJson( url : string ) : Promise<{ service? : unknown; version? : unknown } | undefined>
{
    const ctrl : AbortController = new AbortController();
    const timer : ReturnType<typeof setTimeout> = setTimeout( () => ctrl.abort(), 8000 );
    try
    {
        const res : Response = await fetch( url, { signal: ctrl.signal } );
        if ( !res.ok ) throw new Error( `HTTP ${res.status}` );
        return await res.json() as { service? : unknown; version? : unknown };
    }
    finally { clearTimeout( timer ); }
}

/**
 * Resolve a picker ref to the commit a deploy should ship. A deploy always means "what's on the
 * shared remote", so for a BRANCH we prefer `origin/<ref>` (the freshly-fetched tip) over a local
 * branch of the same name, which can be stale. Tags, commit SHAs, and local-only branches fall
 * through to the literal ref. Assumes a `git fetch` has already run (deployRun does that first).
 */
function resolveRef( ref : string ) : string
{
    try { execFileSync( "git", [ "rev-parse", "--verify", "--quiet", `origin/${ref}^{commit}` ], { cwd: REPO_ROOT, stdio: "ignore" } ); return `origin/${ref}`; }
    catch { /* not a remote branch — a tag, sha, or local-only branch */ }
    try { execFileSync( "git", [ "rev-parse", "--verify", "--quiet", `${ref}^{commit}` ], { cwd: REPO_ROOT, stdio: "ignore" } ); return ref; }
    catch { return ref; }
}

/** Count commits `from` is behind `to` (i.e. commits on `to` not on `from`). 0 if either ref missing. */
function aheadCount( from : string, to : string ) : number
{
    try { return Number( git( [ "rev-list", "--count", `${from}..${to}` ] ).trim() ) || 0; }
    catch { return 0; }
}

/** Is `ref` an existing tag? */
function hasTag( ref : string ) : boolean
{
    try { execFileSync( "git", [ "rev-parse", "--verify", "--quiet", `refs/tags/${ref}` ], { cwd: REPO_ROOT, stdio: "ignore" } ); return true; }
    catch { return false; }
}

/** "release/1.2" (or "origin/release/1.2") → "1.2"; else undefined. */
function releaseLine( ref : string ) : string | undefined
{
    const m : RegExpMatchArray | null = ref.match( /release\/(\d+)\.(\d+)\b/ );
    return m ? `${m[ 1 ]}.${m[ 2 ]}` : undefined;
}

/** Next `vX.Y.Z` for a release line — highest existing patch + 1, else .0. */
function nextTagFor( line : string ) : string
{
    let max : number = -1;
    try
    {
        for ( const t of git( [ "tag", "--list", `v${line}.*` ] ).split( "\n" ).map( ( s ) => s.trim() ).filter( Boolean ) )
        {
            const m : RegExpMatchArray | null = t.match( /^v\d+\.\d+\.(\d+)$/ );
            if ( m ) max = Math.max( max, Number( m[ 1 ] ) );
        }
    }
    catch { /* no tags */ }
    return `v${line}.${max + 1}`;
}

/** Propose the production tag for a ref: the tag itself if `ref` is one (rollback), else next patch
 *  for a release line, else undefined (caller must supply one). */
export function deployProposeTag( ref : string ) : string | undefined
{
    if ( hasTag( ref ) ) return ref;
    const line : string | undefined = releaseLine( ref );
    return line ? nextTagFor( line ) : undefined;
}

/** Does a ref resolve in the local repo? */
function refExists( ref : string ) : boolean
{
    try { execFileSync( "git", [ "rev-parse", "--verify", "--quiet", ref ], { cwd: REPO_ROOT, stdio: "ignore" } ); return true; }
    catch { return false; }
}

/**
 * Open the next release line — create `release/X.(Y+1)` from the newest existing release line (or
 * from main if there are none yet), and push it. The promotion workflow's starting point. See
 * RELEASE.md. Returns the new line name.
 */
export async function openReleaseLine() : Promise<{ ok : boolean; line? : string; error? : string }>
{
    try
    {
        try { execFileSync( "git", [ "fetch", "origin", "--tags", "--prune" ], { cwd: REPO_ROOT, stdio: "ignore" } ); } catch { /* offline */ }

        let maj : number = 0, min : number = -1, found : boolean = false;
        for ( const b of git( [ "branch", "-a", "--format=%(refname:short)" ] ).split( "\n" ).map( ( s ) => s.trim() ).filter( Boolean ) )
        {
            const m : RegExpMatchArray | null = b.match( /release\/(\d+)\.(\d+)\b/ );
            if ( m ) { const a : number = Number( m[ 1 ] ), i : number = Number( m[ 2 ] ); if ( a > maj || ( a === maj && i > min ) ) { maj = a; min = i; found = true; } }
        }

        let base : string, line : string;
        if ( found ) { base = `release/${maj}.${min}`; line = `release/${maj}.${min + 1}`; }
        else { base = refExists( "origin/main" ) ? "origin/main" : refExists( "main" ) ? "main" : git( [ "rev-parse", "--abbrev-ref", "HEAD" ] ).trim(); line = "release/1.0"; }

        if ( refExists( line ) || refExists( `origin/${line}` ) ) return { ok: false, error: `${line} already exists` };

        const baseResolved : string = resolveRef( base );
        SAY( `\n▶ opening ${line} from ${baseResolved}` );
        if ( await processManager.exec( DEPLOY_ID, "deploy", "git", [ "branch", line, baseResolved ], REPO_ROOT ) !== 0 ) return { ok: false, error: `could not create ${line}` };
        if ( await processManager.exec( DEPLOY_ID, "deploy", "git", [ "push", "-u", "origin", line ], REPO_ROOT ) !== 0 ) return { ok: false, error: `created ${line} locally but the push failed` };
        SAY( `✔ ${line} created and pushed` );
        return { ok: true, line };
    }
    catch ( err ) { return { ok: false, error: ( err as Error ).message }; }
}

/** environments.json — what's deployed where. */
export function deployState() : DeployState { return readState(); }

/** Recent audit-trail entries. */
export function deployAudit( limit? : number ) : AuditEntry[] { return readAudit( limit ); }

/**
 * The service × environment map. Each env's deployed ref comes from environments.json (the pointer);
 * we read the versions committed AT that ref and the versions actually LIVE (each service's public
 * /version), plus how far each upstream env's ref is ahead of the next (unpromoted work). Drives the
 * read-only Map view. See RELEASE.md.
 */
export async function deployMap( configs : Record<DeployEnvName, DeployEnvConfig> ) : Promise<DeployMap>
{
    const ids : string[] = listServices().map( ( s ) => s.id );

    // refresh remote refs so committed versions + ahead/behind reflect the latest pushes
    try { execFileSync( "git", [ "fetch", "origin", "--tags", "--prune" ], { cwd: REPO_ROOT, stdio: "ignore" } ); }
    catch { /* offline / no remote — fall back to last-known refs */ }

    const state : DeployState = readState();
    const envs = {} as DeployMap[ "envs" ];
    await Promise.all( DEPLOY_ENVS.map( async ( env : DeployEnvName ) =>
    {
        const ref : string = state[ env ].ref;
        const branchVersions : Record<string, string> = ref ? gitVersions( ref, ids ) : {};
        const { deployed, error } = await deployedVersions( configs[ env ] );
        envs[ env ] = { ref, tag: state[ env ].tag, branchVersions, liveVersions: deployed, liveError: error };
    } ) );

    const dref : string = state.dev.ref, sref : string = state.staging.ref, pref : string = state.production.ref;
    return {
        envs,
        pending:
        {
            devAheadOfStaging        : ( dref && sref ) ? aheadCount( resolveRef( sref ), resolveRef( dref ) ) : undefined,
            stagingAheadOfProduction : ( sref && pref ) ? aheadCount( resolveRef( pref ), resolveRef( sref ) ) : undefined,
        },
    };
}

/** Stack names for an env: optional shared platform stack + one per selected service. */
function stacksFor( req : DeployRequest ) : string[]
{
    const env : DeployEnvName = req.env;
    return [ ...( req.platform ? [ `platform-${env}` ] : [] ), ...req.services.map( ( s ) => `${s}-${env}` ) ];
}

let busy : boolean = false;

/**
 * Run a diff or deploy of the selected stacks at a git ref against a real AWS account. Serialized —
 * one deploy at a time. Returns once the whole flow finishes (or the first step fails).
 */
export async function deployRun( req : DeployRequest ) : Promise<DeployResult>
{
    if ( busy ) return { ok: false, error: "a deploy/diff is already running" };
    const stacks : string[] = stacksFor( req );
    if ( stacks.length === 0 ) return { ok: false, error: "no services selected" };

    // ── enforce the release model + change-control for PRODUCTION deploys (see RELEASE.md) ──────────
    let prodTag : string | undefined;
    if ( req.mode === "deploy" && req.env === "production" )
    {
        if ( !releaseLine( req.ref ) && !hasTag( req.ref ) )
            return { ok: false, error: `production deploys only a release/X.Y line or a vX.Y.Z tag (got "${req.ref}")` };
        if ( !req.approver?.trim() || !req.ticket?.trim() )
            return { ok: false, error: "production deploy requires a named approver and a change ticket (change control)" };
        if ( sameActor( req.approver ) )
            return { ok: false, error: "the approver must differ from the deployer (segregation of duties)" };
        prodTag = req.tag?.trim() || deployProposeTag( req.ref );
        if ( !prodTag ) return { ok: false, error: "could not determine a production tag — provide one" };
    }

    busy = true;
    const wt : string = join( tmpdir(), `rupng-deploy-${req.env}-${Date.now()}` );
    const cloud : string = join( wt, "cloud" );
    const profileEnv : NodeJS.ProcessEnv = { AWS_PROFILE: req.config.profile, AWS_REGION: req.config.region, CDK_DEFAULT_REGION: req.config.region };

    const step = async ( label : string, cmd : string, args : string[], cwd : string, env? : NodeJS.ProcessEnv ) : Promise<boolean> =>
    {
        SAY( `\n━━ ${label} ━━` );
        const code : number = await processManager.exec( DEPLOY_ID, "deploy", cmd, args, cwd, env );
        if ( code !== 0 ) SAY( `✖ ${label} failed (exit ${code})` );
        return code === 0;
    };

    try
    {
        SAY( `\n▶ ${req.mode === "deploy" ? "DEPLOY" : "diff"} ${req.env.toUpperCase()} · ref ${req.ref} · profile ${req.config.profile} (${req.config.region})` );
        SAY( `  stacks: ${stacks.join( ", " )}` );

        // refresh remote refs so a remote-only branch/tag can be deployed, then resolve the ref
        // (prefer the local name; fall back to origin/<ref> for branches not checked out locally)
        await processManager.exec( DEPLOY_ID, "deploy", "git", [ "fetch", "origin", "--tags", "--prune" ], REPO_ROOT );
        const ref : string = resolveRef( req.ref );

        // 1) isolated worktree at the committed ref (so we deploy git, not the dirty working tree)
        if ( !await step( `checkout ${ref} → worktree`, "git", [ "worktree", "add", "--detach", wt, ref ], REPO_ROOT ) )
            return { ok: false, stage: "checkout", error: "could not create the deploy worktree" };

        // 2) install + build (filtered to the selected services; web needs its bin/ for the S3 upload)
        if ( !await step( "npm ci", "npm", [ "ci" ], wt ) )
            return { ok: false, stage: "install" };

        const filters : string[] = req.services.map( ( s ) => `--filter=./apps/core/${s}` );
        if ( filters.length > 0 && !await step( "turbo build", "npx", [ "turbo", "run", "build", ...filters ], wt ) )
            return { ok: false, stage: "build" };

        // 3) cdk diff / deploy from the worktree's cloud/. Non-interactive: --require-approval never.
        const ctx : string[] = [ "-c", `env=${req.env}`, "--profile", req.config.profile ];
        const cdk : string[] = req.mode === "deploy"
            ? [ "cdk", "deploy", ...stacks, ...ctx, "--require-approval", "never" ]
            : [ "cdk", "diff", ...stacks, ...ctx ];
        if ( !await step( `cdk ${req.mode}`, "npx", cdk, cloud, profileEnv ) )
        {
            if ( req.mode === "deploy" ) await record( req, ref, prodTag, "failed" );
            return { ok: false, stage: req.mode };
        }

        // diff previews nothing else; a deploy stamps the prod tag + records state/audit
        if ( req.mode === "diff" ) { SAY( "\n✔ diff complete" ); return { ok: true }; }

        const commit : string = ( () => { try { return git( [ "rev-parse", ref ] ).trim(); } catch { return ""; } } )();

        // production: stamp the immutable tag on the deployed commit (skip if rolling back to an existing tag)
        if ( req.env === "production" && prodTag && !hasTag( prodTag ) && commit )
        {
            if ( await step( `tag ${prodTag}`, "git", [ "tag", prodTag, commit ], REPO_ROOT ) )
                await step( `push ${prodTag}`, "git", [ "push", "origin", prodTag ], REPO_ROOT );
        }

        await record( req, ref, prodTag, "success" );
        SAY( `\n✔ deploy complete${prodTag ? ` · ${prodTag}` : ""}` );
        return { ok: true };
    }
    finally
    {
        // 4) always remove the worktree (best-effort)
        try { git( [ "worktree", "remove", "--force", wt ] ); SAY( `  cleaned up worktree` ); }
        catch { SAY( `  ⚠ could not remove worktree ${wt} — remove it manually` ); }
        busy = false;
    }
}

/** Does the named approver look like the person running the deploy? (segregation-of-duties guard). */
function sameActor( approver : string ) : boolean
{
    const p : string = approver.trim().toLowerCase();
    return p.length > 0 && actor().toLowerCase().includes( p );
}

/**
 * Append the audit entry and (on success) advance the env pointer — committed + pushed to the audit
 * branch by stateStore. On a failed deploy the pointer is left unchanged; the audit line still lands.
 */
async function record( req : DeployRequest, ref : string, tag : string | undefined, result : "success" | "failed" ) : Promise<void>
{
    const ids : string[] = listServices().map( ( s ) => s.id );
    const manifest : Record<string, string> = gitVersions( ref, ids );
    const commit : string = ( () => { try { return git( [ "rev-parse", ref ] ).trim(); } catch { return ""; } } )();
    const ts : string = new Date().toISOString();
    const who : string = actor();
    const action : AuditAction = req.emergency ? "hotfix" : ( hasTag( req.ref ) ? "rollback" : "deploy" );

    const entry : AuditEntry =
    {
        ts, actor: who, action, environment: req.env, ref: req.ref, tag, manifest,
        approver: req.approver, ticket: req.ticket, emergency: req.emergency, result, commit,
    };
    const envState : DeployEnvState = result === "success"
        ? { ref: req.ref, tag, ts, actor: who }
        : readState()[ req.env ];   // unchanged pointer on failure
    await recordDeploy( req.env, envState, entry );
}
