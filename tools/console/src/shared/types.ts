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
/** A webproxy environment config file (apps/core/webproxy/src/config/<name>.json). */
export interface ProxyConfig { web : ProxyWeb; upstreams : ProxyUpstream[]; }

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
    path : string;       // e.g. "/app/bootstrap"
    group : string;      // api source folder: app | auth | common
    hasBody : boolean;   // method typically carries a body (POST/PUT/PATCH) — show the body editor
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
    proxyStart         : "proxy:start",
    proxyStop          : "proxy:stop",
    proxyRestart       : "proxy:restart",
    proxyState         : "proxy:state",
    proxyConfigList    : "proxy:config-list",
    proxyConfigGet     : "proxy:config-get",
    proxyConfigSave    : "proxy:config-save",
    proxyApply         : "proxy:apply",
    proxyGatewayTargets : "proxy:gateway-targets",
    // repo (git check-out / check-in)
    repoStatus         : "repo:status",
    repoBranches       : "repo:branches",
    repoPull           : "repo:pull",
    repoReinstall      : "repo:reinstall",
    repoBump           : "repo:bump",
    repoTest           : "repo:test",
    repoCommitPush     : "repo:commit-push",
    repoCreatePR       : "repo:create-pr",
    watchSyncStart     : "web:watch-sync-start",
    watchSyncStop      : "web:watch-sync-stop",
    watchSyncState     : "web:watch-sync-state",
    targetGet          : "cloud:target-get",
    targetSet          : "cloud:target-set",
    // api tester
    apiDiscover        : "api:discover",
    apiSend            : "api:send",
    apiSavedList       : "api:saved-list",
    apiSavedSave       : "api:saved-save",
    apiSavedDelete     : "api:saved-delete",
    // events (main → renderer, pushed)
    onLog              : "evt:log",
    onProc             : "evt:proc",
    onStage            : "evt:stage",
    onHealth           : "evt:health",
    onLocalStack       : "evt:localstack",
    onClaudeMessage    : "evt:claude-message",
    onClaudeApproval   : "evt:claude-approval",
    onClaudeState      : "evt:claude-state"
} as const;
