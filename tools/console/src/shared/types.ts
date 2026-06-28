//
// Shared IPC contracts — the ONE source of truth for the shapes that cross the main↔renderer
// boundary. Imported by main (Node), preload (bridge), and renderer (React). Keep this file pure
// data/types — no Node, no DOM, no MUI — so all three targets can import it safely.
//

/** A concrete deployable role of a service (a process with its own port), e.g. app → main/public. */
export interface ServiceRole
{
    /** Short role id ("main", "public", "reader", "writer"). */
    role : string;
    /** The role's canonical local-dev port (from @repo/cloud-manifest Ports). */
    port : number;
}

/** What a service can currently do, derived by scanning the repo at startup. */
export interface ServiceCapabilities
{
    /** Has a package.json — i.e. actually scaffolded (vs spec-only/planned). */
    scaffolded : boolean;
    /** Has a `build` npm script → the turbo Build stage is available. */
    canBuild : boolean;
    /** Can produce a Docker image (root Dockerfile + build args). */
    canImage : boolean;
    /** Has a docker-compose.yml → Compose Up/Down + runtime-log follow available. */
    canCompose : boolean;
    /** Backend service with at least one HTTP port → /health pings available. */
    canHealth : boolean;
    /** Has its own `src/CloudManifest.ts` → a deployable cloud stack exists (the Deploy step works).
     *  Services without one (e.g. auth, served through the app gateway) cannot be deployed on their own. */
    canDeploy : boolean;
    /** Frontend (web SPA) — built/served differently; no container/health. */
    isFrontend : boolean;
}

/** A service as the UI sees it: catalog metadata + repo-discovered capabilities. */
export interface ServiceInfo
{
    /** Register.Service id == apps/core/<id> dir == resource prefix. */
    id : string;
    /** Human label for the button ("App", "Auth", "Texting"). */
    label : string;
    /** Name of the MUI icon to render (resolved to a component in the renderer). */
    icon : string;
    /** apps/core/<id> — absolute path on disk. */
    dir : string;
    /** Roles/ports this service runs locally. */
    roles : ServiceRole[];
    /** One-line description for the tooltip / panel header. */
    blurb : string;
    /** Version from apps/core/<id>/package.json (undefined if not scaffolded). */
    version? : string;
    capabilities : ServiceCapabilities;
}

/** The staged pipeline. A run executes a selected subset IN THIS ORDER, halting on first failure. */
export type StageId = "build" | "image" | "deploy";

export const STAGE_ORDER : StageId[] = [ "build", "image", "deploy" ];

/** Pseudo-service id for the local-edge dev proxy (apps/core/webproxy) — for its process/log slot. */
export const WEBPROXY_ID = "webproxy";

/** Pseudo-service id the Repo tab streams git/npm output under. */
export const REPO_ID = "repo";

/** Pseudo-service id the Deploy tab streams git/build/cdk output under. */
export const DEPLOY_ID = "deploy";

/** Pseudo-service id the in-app browser window streams its captured console (console.* / errors) under. */
export const BROWSER_ID = "browser";

/** Default edge port the webproxy listens on when started by the console (8080 is often already taken). */
export const PROXY_DEFAULT_PORT = 9000;

/** Live state of the in-app browser window (open + current URL + history availability). */
export interface BrowserState
{
    open : boolean;
    url : string;
    canBack : boolean;
    canForward : boolean;
}

//
// Per-service run/build settings (persisted in the renderer; pushed to main to drive the orchestrator).
// A TARGET says where the service runs:
//   • "local"      — Build, then run it locally (npm run dev). The orchestrator (re)starts the local
//                    process after a build (a frontend "runs" in the in-app browser window instead).
//   • "localstack" — Build → Docker image → Deploy (cdklocal). The chain CASCADES: Docker needs Build;
//                    Deploy needs Docker (backends) / Build (frontends — deploy = sync bin → bucket).
// `build` applies to both; `docker`/`deploy` only matter under the LocalStack target.
//
export type BuildTarget = "local" | "localstack";

export interface BuildSettings
{
    /** Where the service runs: locally (npm run dev) or deployed to LocalStack (cdklocal). */
    target : BuildTarget;
    /** Auto-run Build (turbo) on a change to this service's src OR a shared package it depends on. */
    build : boolean;
    /** [LocalStack] Auto-build the Docker image after Build (backends only; ignored for frontends). */
    docker : boolean;
    /** [LocalStack] Auto-deploy after the chain (frontend: sync bin→bucket + refresh; backend: cdklocal). */
    deploy : boolean;
}

/** Deploy's prerequisite in the chain: an image first (backend) or just a build (frontend, no image). */
export function deployPrereqMet( s : BuildSettings, isFrontend : boolean ) : boolean
{
    return isFrontend ? s.build : ( s.build && s.docker );
}

/** The auto-on pipeline STAGES to run, in order (build → image → deploy), per target + cascade.
 *  (Local-target "run" is a lifecycle action the orchestrator does after build, not a stage here.)
 *  `canDeploy` gates the deploy step — a service with no cloud stack can never deploy. */
export function autoSteps( s : BuildSettings, isFrontend : boolean, canDeploy : boolean = true ) : StageId[]
{
    const steps : StageId[] = [];
    if ( s.build ) steps.push( "build" );
    if ( s.target === "localstack" )
    {
        if ( s.build && !isFrontend && s.docker ) steps.push( "image" );
        if ( canDeploy && s.deploy && deployPrereqMet( s, isFrontend ) ) steps.push( "deploy" );
    }
    return steps;
}

/** Whether a service's CloudManifest changed since its last LocalStack deploy (→ redeploy to apply). */
export interface ManifestDrift
{
    current : string;            // current manifest hash
    deployed : string | null;    // hash recorded at the last deploy (null = never deployed via the console)
    drifted : boolean;           // deployed != null && current != deployed
}

/** Live state of the sequential build queue — drives the progress bar under the service buttons. */
export interface BuildQueue
{
    queue : string[];          // services still waiting
    current : string | null;   // the one building now
    done : number;             // completed in the current run
    total : number;            // total in the current run
}

// ── Deploy (git → real AWS environment) ────────────────────────────────────────────────────────
//
// The console deploys LOCAL code only to LocalStack (the per-service pipeline). Promoting code to a
// real AWS account is a separate, deliberate flow: pick an environment, pick a committed git ref,
// pick services, then the console checks the ref out into an isolated worktree, builds, and runs
// `cdk deploy <svc>-<env> --profile <p>` (CDK builds + pushes the images and applies CloudFormation).
//

/** The real AWS environments code can be promoted to (LOCAL is the per-service LocalStack pipeline). */
export type DeployEnvName = "dev" | "staging" | "production";

export const DEPLOY_ENVS : DeployEnvName[] = [ "dev", "staging", "production" ];

/** Environment → its long-lived git branch (the branch tip IS what belongs in that account). See RELEASE.md. */
export const ENV_BRANCH : Record<DeployEnvName, string> = { dev: "development", staging: "staging", production: "production" };

/** Per-environment AWS wiring: the named ~/.aws profile + region used for cdk and gateway discovery. */
export interface DeployEnvConfig
{
    /** Named ~/.aws profile passed to `cdk --profile` (and AWS_PROFILE), and used to read deployed versions. */
    profile : string;
    /** AWS region for the deploy. */
    region : string;
}

/** A request to diff or deploy selected service stacks of a git ref to an environment. */
export interface DeployRequest
{
    env : DeployEnvName;
    /** Service ids (apps/core/<id>) → stacks `<id>-<env>`. */
    services : string[];
    /** Also (re)deploy the shared `platform-<env>` stack. */
    platform : boolean;
    /** Committed git ref (a `release/X.Y` line, or a `vX.Y.Z` tag for rollback) to deploy from. */
    ref : string;
    /** "diff" previews CloudFormation changes; "deploy" applies them. */
    mode : "diff" | "deploy";
    /** AWS wiring for the target env. */
    config : DeployEnvConfig;
    /** Production only: the immutable tag to stamp on the deployed commit (proposed vX.Y.Z, editable). */
    tag? : string;
    /** Production only: the named approver (must differ from the actor) — change-control authorization. */
    approver? : string;
    /** Production only: linked change ticket / issue id. */
    ticket? : string;
    /** Production only: emergency change (e.g. skip-staging hotfix) — flagged for retroactive review. */
    emergency? : boolean;
}

// ── deploy state (environments.json) + audit trail (deploy-audit.jsonl) ────────────────────────
// Environments are POINTERS: environments.json records which ref/tag is currently deployed to each
// account. Both files live on a protected "state/audit" branch (default `main`) so the record is
// stable regardless of the working branch, and the Console commits them (signed) + pushes per deploy.

/** What is currently deployed to one environment. */
export interface DeployEnvState
{
    /** The ref deployed (a `release/X.Y` line, or a `vX.Y.Z` tag). */
    ref : string;
    /** The immutable production tag (production only). */
    tag? : string;
    /** ISO timestamp of the deploy. */
    ts? : string;
    /** Who performed it (git identity). */
    actor? : string;
}

/** environments.json — the env → deployed-ref pointers. */
export interface DeployState
{
    dev : DeployEnvState;
    staging : DeployEnvState;
    production : DeployEnvState;
}

export type AuditAction = "deploy" | "rollback" | "hotfix" | "promote";

/** One append-only line in deploy-audit.jsonl (see RELEASE.md → Compliance & Controls). */
export interface AuditEntry
{
    ts : string;                          // UTC ISO
    actor : string;                       // git identity that ran it
    action : AuditAction;
    environment : DeployEnvName;
    ref : string;                         // what was deployed
    tag? : string;                        // resulting immutable tag (production)
    manifest : Record<string, string>;    // per-service versions at the deployed commit
    approver? : string;                   // required for production (≠ actor)
    ticket? : string;
    emergency? : boolean;
    result : "success" | "failed";
    commit? : string;                     // deployed commit sha
    signed? : boolean;                    // whether the audit commit was GPG/SSH-signed
}

/** Outcome of a deploy/diff run (per the streamed log). */
export interface DeployResult { ok : boolean; stage? : string; error? : string; }

/** Versions of each service at a git ref (from package.json) vs what's actually running in an env. */
export interface DeployVersions
{
    /** service id → package.json version at the requested ref. */
    git : Record<string, string>;
    /** service id → version reported by the env's aggregated /version (empty if unreachable). */
    deployed : Record<string, string>;
    /** non-fatal note (e.g. /version endpoint not reachable / not yet deployed). */
    error? : string;
}

/** One environment's column in the service × environment map. */
export interface DeployEnvMap
{
    /** The ref currently deployed to this env (a `release/X.Y` line or `vX.Y.Z` tag), from environments.json. */
    ref : string;
    /** The immutable production tag, when set. */
    tag? : string;
    /** service id → version committed at `ref`. */
    branchVersions : Record<string, string>;
    /** service id → version actually running (from each service's public /version). */
    liveVersions : Record<string, string>;
    /** non-fatal note when live versions couldn't be read (no profile / not deployed / unreachable). */
    liveError? : string;
}

/** The whole service × environment map + pending-promotion counts between stages. */
export interface DeployMap
{
    envs : Record<DeployEnvName, DeployEnvMap>;
    /** commits each upstream env branch is ahead of the next (unreleased / pending-release work). */
    pending : { devAheadOfStaging? : number; stagingAheadOfProduction? : number };
    error? : string;
}

// ── Repo (git check-out / check-in) ──────────────────────────────────────────────────────────────

export type RepoAreaKind = "service" | "package" | "cloud" | "console" | "root";
export type BumpKind = "patch" | "minor" | "major";

/** A workspace area (service/package/cloud/…) with pending git changes. */
export interface RepoArea
{
    path : string;        // workspace-relative path, e.g. "apps/core/app", "packages/api", "cloud"
    name : string;        // display name, e.g. "app", "api", "cloud"
    kind : RepoAreaKind;
    changed : number;     // number of changed files in this area
    files : string[];     // the changed file paths in this area (for precise staging)
    version? : string;    // current package.json version (if the area has one)
    deleted? : boolean;   // the directory no longer exists on disk (fully removed)
}

export interface RepoStatus
{
    branch : string;
    areas : RepoArea[];
    conflicts : string[];   // conflicted file paths (merge needs resolving)
    clean : boolean;        // nothing changed
    error? : string;
}

/** Local + remote branches (origin/ stripped, de-duped) and the current one. */
export interface RepoBranches { current : string; branches : string[]; }

/** An outdated npm dependency (from `npm outdated`) — installed vs available. */
export interface NpmOutdated
{
    name : string;
    current : string;     // installed version
    wanted : string;      // max satisfying the package.json range
    latest : string;      // newest published
    dependent : string;   // which workspace/package depends on it
}

/** One package.json declaring a dependency at a given version. */
export interface VersionOccurrence { area : string; version : string; dev : boolean; }
/** A library declared at >1 version across package.json files — the newest is the sync target. */
export interface VersionConflict { name : string; newest : string; occurrences : VersionOccurrence[]; }

/** One reverse-proxied upstream in the webproxy config (a path-prefix → target host). */
export interface ProxyUpstream
{
    name : string;
    target : string;            // effective target the proxy uses
    prefixes : string[];
    ws? : string;
    outside? : string;          // candidate target when the service runs locally (default: target)
    inside? : string;           // candidate target when the service is deployed (LocalStack/remote gateway)
}

/** Where a service's traffic is routed: Outside = local container, Inside = deployed in the cloud. */
export type RouteMode = "outside" | "inside";
/** Static-SPA serving block of the webproxy config. */
export interface ProxyWeb { root : string; index? : string; prefix? : string; spaFallback? : boolean; }
/**
 * One generated route in the LOCAL per-endpoint table (mounted on /api in the webproxy): an endpoint
 * (method + path, with :params) → the role-service that registers it. Mirrors the production gateway's
 * per-route dispatch, so /api/auth/v1/login can hit the writer while a read hits the reader — without
 * the role ever appearing in the path. Generated from the endpoint→role bindings; never hand-written.
 */
export interface ProxyRoute { method : string; path : string; target : string; }
/** A webproxy environment config file (apps/core/webproxy/src/config/<name>.json). */
export interface ProxyConfig { web : ProxyWeb; upstreams : ProxyUpstream[]; routes? : ProxyRoute[]; }

export type StageStatus = "idle" | "running" | "success" | "failed" | "skipped";

/** Where a deploy stage targets. v1 is LocalStack-only (compose + cdklocal). */
export type DeployTarget = "compose" | "cdklocal";

/** Per-service, per-stage status snapshot (drives the resumable pipeline UI). */
export type StageState = Record<StageId, StageStatus>;

/** A line of console output streamed from a child process. */
export interface LogLine
{
    /** Service id this line belongs to. */
    service : string;
    /** Which stream produced it (build/image/deploy stages + the runtime follow). */
    stream : LogStream;
    /** Monotonic line sequence (per service+stream) for stable keys + ordering. */
    seq : number;
    /** ms epoch (stamped in main). */
    ts : number;
    /** "out" | "err" | "sys" (sys = console's own annotations: started/exited/etc). */
    level : "out" | "err" | "sys";
    /** Raw text (may contain ANSI; the viewer renders it). */
    text : string;
}

export type LogStream = StageId | "runtime";

export const LOG_STREAMS : LogStream[] = [ "build", "image", "deploy", "runtime" ];

/** Live state of a running/finished child process for a service+stream. */
export interface ProcState
{
    service : string;
    stream : LogStream;
    running : boolean;
    /** OS pid while running. */
    pid? : number;
    /** The command line (for display / Ask-Claude context). */
    command? : string;
    /** Exit code once finished (null while running). */
    exitCode? : number | null;
    startedAt? : number;
    endedAt? : number;
}

/** Result of a health ping against one role. */
export interface HealthResult
{
    service : string;
    role : string;
    port : number;
    url : string;
    ok : boolean;
    /** HTTP status (0 if the request never connected). */
    status : number;
    /** Round-trip ms. */
    latencyMs : number;
    /** Parsed JSON body if any, else raw text (truncated). */
    body? : unknown;
    error? : string;
    ts : number;
}

/** LocalStack lifecycle state (the shared dependency every local deploy needs). */
export interface LocalStackState
{
    /** "running" | "stopped" | "unknown" (docker not reachable). */
    status : "running" | "stopped" | "unknown";
    /** Container health string if available. */
    detail? : string;
    ts : number;
}

/** A request to run the pipeline for one service. */
export interface PipelineRequest
{
    service : string;
    /** Which stages to run (in STAGE_ORDER). */
    stages : StageId[];
    /** Deploy mechanism when the `deploy` stage is included. */
    target : DeployTarget;
    /**
     * If true, stages already marked `success` are skipped (resume). If false, the selected
     * stages all re-run. The UI's "resume from failure" sets this true.
     */
    resume : boolean;
}

/** Outcome of a whole pipeline run (per-stage). */
export interface PipelineResult
{
    service : string;
    stages : StageState;
    /** True if every selected stage ended in success. */
    ok : boolean;
}

//
// ── Claude integration ────────────────────────────────────────────────────────────────────────
//
// The in-app Claude (via @anthropic-ai/claude-agent-sdk). A single MODE dial controls if/when it
// engages on a failure and how much it may do.
//

export type ClaudeMode =
    | "off"        // never engages
    | "ondemand"   // manual "Diagnose" only; read-only (no file edits)
    | "realtime"   // auto-engages on a failed stage; read-only diagnosis
    | "fix";       // auto-engages on a failed stage; may edit files / run commands — each gated by approval

export const CLAUDE_MODES : { value : ClaudeMode; label : string; hint : string }[] =
[
    { value: "off",      label: "Off",                  hint: "Claude never engages." },
    { value: "ondemand", label: "Diagnose on demand",   hint: "Manual button; reads logs + code, suggests fixes (no edits)." },
    { value: "realtime", label: "Real-time diagnose",   hint: "Auto-runs on a failed stage; read-only diagnosis." },
    { value: "fix",      label: "Fix upon approval",    hint: "Auto-runs on failure; can edit/run with per-action approval." }
];

export type ClaudeMsgKind = "status" | "user" | "assistant" | "tool" | "tool_result" | "result" | "error";

/** One rendered item in the Claude panel transcript. */
export interface ClaudeMessage
{
    service : string;
    id : string;
    kind : ClaudeMsgKind;
    text : string;
    ts : number;
    toolName? : string;
}

/** A pending tool-use Claude wants to run in "fix" mode — awaits Approve/Reject in the UI. */
export interface ClaudeApprovalRequest
{
    id : string;
    service : string;
    toolName : string;
    /** Pretty-printed summary of what it wants to do. */
    summary : string;
}

export interface ClaudeSessionState
{
    service : string;
    /** A session is open (the conversation can take follow-up prompts). */
    running : boolean;
    /** Claude is actively working on the current turn (vs. idle, awaiting your next message). */
    thinking? : boolean;
}

//
// ── Jobs / Lambdas ────────────────────────────────────────────────────────────────────────────
//

/** A Lambda job discovered in a service (src/jobs/<Name>.ts exporting `handler`). */
export interface JobInfo
{
    service : string;
    /** File base name without extension, e.g. "AppTicketJob". */
    name : string;
    /** Handler ref as the manifest declares it, e.g. "jobs/AppTicketJob.handler". */
    handler : string;
    /** Absolute source path. */
    file : string;
}

/** A Lambda function deployed to LocalStack (matched to a service by name prefix). */
export interface LambdaFn
{
    name : string;
    runtime? : string;
    lastModified? : string;
}

/** Result of invoking a Lambda against LocalStack. */
export interface InvokeResult
{
    ok : boolean;
    statusCode? : number;
    /** Lambda function-level error type, if the handler threw. */
    functionError? : string;
    /** Decoded tail of the execution log (--log-type Tail). */
    logTail? : string;
    /** Parsed response payload. */
    payload? : unknown;
    error? : string;
}

//
// ── LocalStack monitor (the "Monitor" tab) ──────────────────────────────────────────────────────
//
// The Cloud graph is auto-derived from the deployed CloudFormation stacks: resources become nodes,
// template references (Ref / Fn::GetAtt / DependsOn) become edges. The renderer lays it out (dagre).
//

/** Coarse grouping used for node color + which tier it tends to sit in. */
export type CloudCategory =
    | "edge"          // CloudFront, API Gateway, WAF
    | "network"       // ALB/listener, VPC, security groups (kept ones)
    | "compute"       // ECS service/task, Lambda, Batch
    | "messaging"     // SQS, SNS, EventBridge, MSK/Kafka, Kinesis
    | "data"          // DynamoDB, S3, OpenSearch, RDS/Aurora, ElastiCache
    | "identity"      // Cognito, Secrets, AppConfig
    | "observability" // Log groups, alarms
    | "other";

/** One deployed CloudFormation resource. */
export interface CloudNode
{
    /** Unique: `${stack}/${logicalId}`. */
    id : string;
    stack : string;
    logicalId : string;
    /** CloudFormation type, e.g. "AWS::DynamoDB::Table". */
    type : string;
    /** Short friendly type label, e.g. "DynamoDB Table". */
    typeLabel : string;
    category : CloudCategory;
    /** The real resource name/id in LocalStack, when known. */
    physicalId? : string;
    /** CloudFormation resource status, e.g. "CREATE_COMPLETE". */
    status? : string;
    /** CloudWatch log group to tail for this resource, when applicable (Lambda/ECS). */
    logGroup? : string;
}

export interface CloudEdge
{
    from : string;
    to : string;
}

export interface CloudGraph
{
    /** Active stack names found. */
    stacks : string[];
    nodes : CloudNode[];
    edges : CloudEdge[];
    /** Non-fatal note (e.g. CLI missing, LocalStack down). */
    error? : string;
    ts : number;
}

/** /_localstack/health — which AWS services LocalStack has available/running. */
export interface CloudHealth
{
    reachable : boolean;
    /** service → state ("running" | "available" | "disabled" | …). */
    services : Record<string, string>;
    edition? : string;
    error? : string;
    ts : number;
}

/** One CloudWatch log event. */
export interface LogEvent
{
    ts : number;
    message : string;
}

/** One object in an S3 bucket. */
export interface S3Object
{
    key : string;
    size : number;
    lastModified? : string;
}

/** A page of an S3 bucket listing at a prefix (folder-style, delimiter "/"). */
export interface S3Listing
{
    bucket : string;
    prefix : string;
    /** "Sub-folder" common prefixes under this prefix. */
    folders : string[];
    objects : S3Object[];
    truncated : boolean;
    error? : string;
}

/** One route registered on an API Gateway (HTTP API v2). */
export interface ApiGwRoute
{
    routeKey : string;
    target? : string;
}

/** An API Gateway HTTP API + its routes. */
export interface ApiGwInfo
{
    apiId : string;
    name? : string;
    protocol? : string;
    endpoint? : string;
    routes : ApiGwRoute[];
    error? : string;
}

/** Origin grouping for a running container. */
export type ContainerKind = "service" | "ecs-task" | "lambda" | "localstack" | "infra";

/** A running Docker container with live stats (docker ps + docker stats). */
export interface ContainerInfo
{
    id : string;
    name : string;
    image : string;
    state : string;
    status : string;
    kind : ContainerKind;
    /** docker-reported strings, shown as-is (e.g. "0.31%", "24.68MiB / 7.75GiB"). */
    cpuPercent? : string;
    memUsage? : string;
    memPercent? : string;
}

/** Live state of a deployed ECS service (DescribeServices). */
export interface EcsServiceState
{
    status? : string;
    desiredCount? : number;
    runningCount? : number;
    pendingCount? : number;
    error? : string;
}

//
// ── VpcLink data-path diagnosis ─────────────────────────────────────────────────────────────────
//
// A read-only walk of API Gateway (HTTP API) → VpcLink → ALB → ECS to pinpoint where a request
// would break — most usefully, whether running ECS tasks are actually registered+healthy in the
// ALB target group (the common LocalStack data-path gap). Shareable as evidence for support.
//

export type DiagLevel = "ok" | "warn" | "error";

export interface DiagFinding { level : DiagLevel; title : string; detail : string; }

export interface DiagTask { taskArn : string; lastStatus : string; healthStatus : string; ip? : string; }
export interface DiagService { cluster : string; service : string; desired : number; running : number; tasks : DiagTask[]; }

export interface DiagTarget { id : string; port? : number; state : string; reason? : string; }
export interface DiagTargetGroup { name : string; protocol? : string; port? : number; targetType? : string; targets : DiagTarget[]; }

export interface DiagLoadBalancer { name : string; type? : string; scheme? : string; state? : string; dnsName? : string; }
export interface DiagVpcLink { id : string; name? : string; status? : string; }

export interface DiagIntegration { id : string; connectionType? : string; connectionId? : string; uri? : string; }
export interface DiagApi { apiId : string; name? : string; protocol? : string; endpoint? : string; routes : string[]; integrations : DiagIntegration[]; }

/** Result of actually invoking a route through the gateway (the "Test routing" button). */
export interface RouteTest
{
    apiId : string;
    routeKey : string;
    method : string;
    url : string;
    ok : boolean;
    status : number;
    timeMs : number;
    bodySnippet? : string;
    error? : string;
}

export interface VpcLinkDiagnosis
{
    targetKind : "localstack" | "aws";
    generatedAt : number;
    services : DiagService[];
    targetGroups : DiagTargetGroup[];
    loadBalancers : DiagLoadBalancer[];
    vpcLinks : DiagVpcLink[];
    apis : DiagApi[];
    findings : DiagFinding[];
    error? : string;
}

//
// ── Target (LocalStack vs a real AWS account) ───────────────────────────────────────────────────
//
// The cloud SDK clients point at either LocalStack (local, throwaway creds) or a real AWS account
// (a named ~/.aws profile + region). A real account is treated READ-ONLY: no Lambda invoke, no
// mutating actions — you never invoke functions on AWS just to read stats.
//

export type TargetKind = "localstack" | "aws";

export interface Target
{
    kind : TargetKind;
    /** ~/.aws profile name (aws only). */
    profile? : string;
    /** region (aws only; localstack is fixed us-east-1). */
    region? : string;
}

/** The active target plus the read-only flag and the choices available to the selector. */
export interface TargetInfo
{
    target : Target;
    /** true when targeting a real AWS account → destructive actions disabled. */
    readOnly : boolean;
    /** profiles discovered in ~/.aws (config + credentials). */
    profiles : string[];
    /** common regions offered in the selector. */
    regions : string[];
}

//
// ── API tester (the "API" tab — a per-service Postman-style client) ──────────────────────────────
//

/** An endpoint discovered from @repo/api's RestfulEndpoint definitions. */
export interface ApiEndpointDef
{
    name : string;       // the endpoint class, e.g. "GetBootstrap"
    method : string;     // GET / POST / …
    path : string;       // e.g. "/api/app/v1/bootstrap"
    group : string;      // api source folder: app | auth | common
    hasBody : boolean;   // method typically carries a body (POST/PUT/PATCH) — show the body editor
    // Audience (RestfulEndpoint.Audience): INTERNAL = VPC-only inter-service · APP = first-party edge
    // · PUBLIC = published dev API edge. Only APP/PUBLIC are edge-reachable (browser/proxy route table);
    // INTERNAL is service-to-service only. Defaults to INTERNAL when the endpoint doesn't declare it.
    audience? : "INTERNAL" | "APP" | "PUBLIC";
    // The service VARIANT (role) this endpoint is registered on + its port, captured from the
    // role-service's registerEndpoints() (e.g. AppPublicService → role "public" → :8101). Undefined
    // when it's registered on every role (e.g. /health via the base) or can't be resolved.
    role? : string;
    port? : number;
}

/** One header/query row in the request builder (enabled lets you keep but skip a row). */
export interface KeyVal { key : string; value : string; enabled : boolean; }

/** A request to actually send (assembled URL + headers + optional raw body). */
export interface ApiRequestSpec
{
    method : string;
    url : string;                  // full URL incl. query string
    headers : Record<string, string>;
    body? : string;                // raw request body (e.g. JSON text)
    timeoutMs? : number;
}

/** The response from a sent request. */
export interface ApiResponse
{
    ok : boolean;
    status : number;
    statusText : string;
    headers : Record<string, string>;
    body : string;                 // raw response text
    contentType? : string;
    timeMs : number;
    size : number;                 // bytes
    error? : string;
}

/** A named, saved request (committed to the repo per service, grouped by endpoint). */
export interface SavedRequest
{
    id : string;
    name : string;
    endpoint : string;             // endpoint key it's saved under, e.g. "GET /app/bootstrap"
    method : string;
    /** role port to hit (direct service port) + path; the URL is assembled at send time. */
    port : number;
    path : string;
    headers : KeyVal[];
    query : KeyVal[];
    body? : string;
}

// ── AppConfig (the Config tab) ────────────────────────────────────────────────────────────────
// A service maps to an AppConfig application; each profile is a sub-config (settings/web/flags/…).

/** An AppConfig environment = an in-account deploy target (default "default"). */
export interface ConfigEnvironment { id : string; name : string; state? : string; }

/** A configuration profile = one sub-config. `type` is "AWS.Freeform" or "AWS.AppConfig.FeatureFlags". */
export interface ConfigProfile { id : string; name : string; type : string; }

/** The config tree for a service: its application + the profiles (sub-configs) and environments. */
export interface ServiceConfigTree
{
    applicationId?   : string;
    applicationName? : string;
    environments     : ConfigEnvironment[];
    profiles         : ConfigProfile[];
    error?           : string;
}

/** Latest hosted content of a profile (the JSON to edit). */
export interface ConfigContent { content : string; version? : number; contentType : string; error? : string; }

/** Result of saving (new hosted version + deployment). */
export interface ConfigSaveResult { ok : boolean; version? : number; deployment? : number; error? : string; }

// ── DynamoDB (the Data tab) — a service's tables + item browse/edit ─────────────────────────────
export interface DynamoTable { name : string; key : string; }                 // physical name + logical key
export interface DynamoKeySchema { partitionKey : string; sortKey? : string; }
export interface DynamoScanResult { items : Array<Record<string, unknown>>; lastKey? : Record<string, unknown>; error? : string; }
export interface DynamoSaveResult { ok : boolean; error? : string; }

// ── Cognito (the Cognito tab) — user pool + user browse/edit ────────────────────────────────────
export interface CognitoPool { id : string; name : string; }
export interface CognitoUser
{
    username    : string;
    status?     : string;                       // e.g. CONFIRMED / FORCE_CHANGE_PASSWORD
    enabled     : boolean;
    attributes  : Record<string, string>;       // sub, email, email_verified, given_name, …
    createdAt?  : string;
    modifiedAt? : string;
}
export interface CognitoResult { ok : boolean; error? : string; }

// ── Kafka monitor (the Events sub-tab) ─────────────────────────────────────────────────────────
/** A binding edge in the topology — one service's publish or subscribe of a topic. */
export interface MonitorBinding { topic : string; group? : string; }
/** A service node in the radial graph + the topics it publishes/subscribes (mirrors the manifests). */
export interface MonitorService { id : string; publishes : string[]; subscribes : MonitorBinding[]; }
/** The whole topology: service nodes + the distinct set of topics (pipes radiate to the central hub). */
export interface MonitorTopology { services : MonitorService[]; topics : string[]; }

/** One observed Kafka event (an Events.Envelope the monitor consumed), enriched for the UI. */
export interface MonitorEvent
{
    eventId    : string;
    topic      : string;          // = Events.Object/Stream (the "noun"), e.g. "auth.user"
    verb       : string;          // created / updated / deleted / purged / accessed (color)
    action     : string;          // `${topic}.${verb}`
    accountId  : string;
    targetType : string;
    targetId   : string;
    publisher  : string;          // service that publishes this topic (from topology), or "?"
    subscribers : string[];       // consumer groups bound to this topic (from topology)
    occurredAt : string;          // envelope time
    arrivedAt  : number;          // epoch ms the monitor received it (TTL clock)
    partition  : number;
    offset     : string;
    sizeBytes  : number;          // JSON byte size of envelope.data (drives circle radius)
    envelope   : unknown;         // full envelope (the model-data inspector)
    delivered  : string[];        // subscriber groups confirmed past this offset
    finishedAt? : number;         // set once ALL subscriber groups consumed it → it's in the bin
}

/** Snapshot returned by monitorStart / monitorState. */
export interface MonitorState
{
    running   : boolean;
    brokers   : string;
    error?    : string;
    topology  : MonitorTopology;
    events    : MonitorEvent[];   // everything within the TTL window (live + binned; bin = finishedAt set)
    ttlMs     : number;
    maxTtlMs  : number;
}

/** Periodic reconciliation pushed to the renderer: delivery progress + which events aged out. */
export interface MonitorSync
{
    delivered : Array<{ eventId : string; delivered : string[]; finishedAt? : number }>;
    removed   : string[];         // eventIds pruned (older than TTL)
}

/** IPC channel names — referenced by both preload and main so they can't drift. */
export const IPC =
{
    // invoke (request/response)
    listServices       : "services:list",
    rescanServices     : "services:rescan",
    runPipeline        : "pipeline:run",
    stopStream         : "stream:stop",
    stopService        : "service:stop-all",
    getStageStates     : "pipeline:states",
    getProcStates      : "proc:states",
    getLog             : "log:get",
    clearLog           : "log:clear",
    logPath            : "log:path",
    claudePrompt       : "claude:prompt",
    pingHealth         : "health:ping",
    pingAll            : "health:ping-all",
    composeDown        : "compose:down",
    localstackStatus   : "localstack:status",
    localstackUp       : "localstack:up",
    localstackDown     : "localstack:down",
    repoRoot           : "repo:root",
    // claude
    claudeGetMode      : "claude:get-mode",
    claudeSetMode      : "claude:set-mode",
    claudeStart        : "claude:start",
    claudeSend         : "claude:send",
    claudeStop         : "claude:stop",
    claudeApprove      : "claude:approve",
    claudeHistory      : "claude:history",
    claudeClear        : "claude:clear",
    claudeMessages     : "claude:messages",
    // jobs / lambdas
    jobsList           : "jobs:list",
    lambdaList         : "lambda:list",
    lambdaInvoke       : "lambda:invoke",
    // cloud monitor
    cloudGraph         : "cloud:graph",
    cloudHealth        : "cloud:health",
    cloudTail          : "cloud:tail",
    s3List             : "cloud:s3-list",
    apigwRoutes        : "cloud:apigw-routes",
    dockerContainers   : "cloud:containers",
    ecsService         : "cloud:ecs-service",
    ecsMetrics         : "cloud:ecs-metrics",
    vpcLinkDiagnose    : "cloud:vpclink-diagnose",
    webAppUrl          : "web:app-url",
    openExternal       : "shell:open-external",
    devStart           : "web:dev-start",
    devStop            : "web:dev-stop",
    tailDeployedStart  : "deploy:tail-start",
    tailDeployedStop   : "deploy:tail-stop",
    deployedPorts      : "deploy:ports",
    manifestDrift      : "deploy:manifest-drift",
    proxyStart         : "proxy:start",
    proxyStop          : "proxy:stop",
    proxyRestart       : "proxy:restart",
    proxyState         : "proxy:state",
    proxyConfigList    : "proxy:config-list",
    proxyConfigGet     : "proxy:config-get",
    proxyConfigSave    : "proxy:config-save",
    proxyApply         : "proxy:apply",
    proxyGatewayTargets : "proxy:gateway-targets",
    proxyLocalRoutes   : "proxy:local-routes",
    // repo (git check-out / check-in)
    repoStatus         : "repo:status",
    repoBranches       : "repo:branches",
    repoPull           : "repo:pull",
    repoReinstall      : "repo:reinstall",
    repoBump           : "repo:bump",
    repoTest           : "repo:test",
    repoCommitPush     : "repo:commit-push",
    repoCreatePR       : "repo:create-pr",
    repoOutdated       : "repo:outdated",
    repoUpdateDeps     : "repo:update-deps",
    repoVersionConflicts : "repo:version-conflicts",
    repoSyncVersions   : "repo:sync-versions",
    watchSyncStart     : "web:watch-sync-start",
    watchSyncStop      : "web:watch-sync-stop",
    watchSyncState     : "web:watch-sync-state",
    // build orchestration (per-service Auto: build/docker/deploy chain + sequential cross-service queue)
    buildConfigure     : "build:configure",
    buildQueueGet      : "build:queue-get",
    buildRunStep       : "build:run-step",
    buildRunNow        : "build:run-now",
    buildAll           : "build:all",
    // deploy (git → real AWS environment)
    deployRefs         : "deploy:refs",
    deployGitVersions  : "deploy:git-versions",
    deployedVersions   : "deploy:deployed-versions",
    deployRun          : "deploy:run",
    deployMap          : "deploy:map",
    deployState        : "deploy:state",
    deployAudit        : "deploy:audit",
    deployProposeTag   : "deploy:propose-tag",
    deployOpenLine     : "deploy:open-line",
    // in-app browser window (console capture)
    browserOpen        : "browser:open",
    browserClose       : "browser:close",
    browserReload      : "browser:reload",
    browserBack        : "browser:back",
    browserForward     : "browser:forward",
    browserResize      : "browser:resize",
    browserState       : "browser:state",
    targetGet          : "cloud:target-get",
    targetSet          : "cloud:target-set",
    // appconfig (the Config tab)
    configProfiles     : "config:profiles",
    configGet          : "config:get",
    configSave         : "config:save",
    // dynamodb (the Data tab)
    dynamoTables       : "dynamo:tables",
    dynamoTableInfo    : "dynamo:table-info",
    dynamoScan         : "dynamo:scan",
    dynamoPut          : "dynamo:put",
    dynamoDelete       : "dynamo:delete",
    // cognito (the Cognito tab)
    cognitoPools       : "cognito:pools",
    cognitoUsers       : "cognito:users",
    cognitoCreateUser  : "cognito:create-user",
    cognitoUpdateUser  : "cognito:update-user",
    cognitoSetEnabled  : "cognito:set-enabled",
    cognitoDeleteUser  : "cognito:delete-user",
    cognitoSetPassword : "cognito:set-password",
    // api tester
    apiDiscover        : "api:discover",
    apiSend            : "api:send",
    apiSavedList       : "api:saved-list",
    apiSavedSave       : "api:saved-save",
    apiSavedDelete     : "api:saved-delete",
    // kafka monitor (the Events sub-tab)
    monitorStart       : "monitor:start",
    monitorStop        : "monitor:stop",
    monitorState       : "monitor:state",
    monitorSetTtl      : "monitor:set-ttl",
    monitorClear       : "monitor:clear",
    // events (main → renderer, pushed)
    onLog              : "evt:log",
    onProc             : "evt:proc",
    onStage            : "evt:stage",
    onHealth           : "evt:health",
    onLocalStack       : "evt:localstack",
    onClaudeMessage    : "evt:claude-message",
    onClaudeApproval   : "evt:claude-approval",
    onClaudeState      : "evt:claude-state",
    onBrowser          : "evt:browser",
    onBuildQueue       : "evt:build-queue",
    onMonitorEvent     : "evt:monitor-event",     // one new event arrived on the bus
    onMonitorSync      : "evt:monitor-sync"        // periodic delivery/bin/prune reconciliation
} as const;
