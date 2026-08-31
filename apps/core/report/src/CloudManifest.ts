//
// report — CloudManifest: the service's AWS footprint (resource manifest, no CDK/AWS coupling). See
// apps/core/report/SPECS.md for the full design. Deferred scope (documented there, not built here):
//   * Athena / materialized-view querying (report-9.0) — no Athena facade exists anywhere on the platform
//     yet; ReportViewJob (view refresh + artifact-lifecycle sweep) is therefore NOT wired up in this cut —
//     generators read the owning services' internal S2S list endpoints directly instead.
//   * The ECS/Fargate long-generation path — this cut is Lambda-only (< 15 min); a long-running Fargate
//     generator lands when a report actually needs it.
//   * Per-account retention override (ReportConfig's `retentionDays` is the environment-max only today).
//   * `specVersion` auto-migration — `GetReportSchedulesStale` (human-in-the-loop, CS-driven) is the only
//     migration surface; no automatic rewrite of a standing Schedule's pinned version.
//
import {
    ResourceManifest,
    ApiAuthorizer, LaunchType, BucketAccess,
    AttrType,
    Ports,
    JobRuntime, ResourceKind, AccessIntent,
} from "@repo/cloud-manifest";

export const manifest : ResourceManifest =
{
    service     : "report",
    description : "The reporting factory — parameterized, role-gated, repeatable report generation: submit (ad-hoc or recurring iCal), generate asynchronously, store the artifact in S3, and emit report.completed for the account's workflow to route delivery.",
    tracing     : true,

    owns:
    {
        // The ECS Fargate role — the /report/* API (also drains report-generate in-process for local/dev —
        // see ReportMainService).
        services:
        [
            {
                key             : "main",
                launchType      : LaunchType.FARGATE,
                containerPort   : Ports.REPORT.MAIN,
                healthCheckPath : "/health",
                environment     : { SERVICE_ROLE: "main", LOG_LEVEL: "info" },
                sizing          : { default: { cpu: 1, memory: 2 }, production: { cpu: 2, memory: 4 } },
                autoscaling     : { default: { min: 1, max: 2, start: 1, targetCpuPercent: 60 },
                                    production: { min: 2, max: 6, start: 2, targetCpuPercent: 60 } },
                loadBalancer    : { public: false },
            },
        ],

        // API gateway (the front door). The service enforces auth itself -> authorizer NONE.
        api:
        {
            key        : "api",
            authorizer : ApiAuthorizer.NONE,
            cors       : true,
            throttle   : { default: { rateLimit: 100, burstLimit: 200 },
                           production: { rateLimit: 1000, burstLimit: 2000 } },
            endpoints  :
            [
                { method: "GET", path: "/version", public: true, authRequired: false },
                { method: "GET", path: "/health",  public: true, authRequired: false },
            ],
        },

        // Runtime config (AppConfig) — the environment-max artifact retention (report-11.1), tunable
        // without a redeploy.
        appConfig:
        [
            { key: "config", application: "report", profiles: [ { key: "settings" } ] },
        ],

        // Private bucket — generated report artifacts. Lifecycle expiry by object age (no date in the key;
        // DynamoDB is the index). 90 = ReportConfig.DEFAULT.retentionDays, the environment-max baseline this
        // manifest hardcodes at deploy time (a per-account override, if it ever lands, would still need to be
        // <= this literal — see the file-header deferred-scope note).
        buckets:
        [
            { key: "report", access: BucketAccess.PRIVATE, encryption: true,
              lifecycle: [ { expireDays: 90 } ] },
        ],

        tables:
        [
            // Submissions — one execution per row. "status" GSI lets a list-by-status query skip a scan.
            { key: "report_submissions", partitionKey: { name: "accountId", type: AttrType.STRING }, sortKey: { name: "submissionId", type: AttrType.STRING },
              globalSecondaryIndexes: [
                  { name: "status", partitionKey: { name: "accountId", type: AttrType.STRING }, sortKey: { name: "status", type: AttrType.STRING }, projection: "ALL" },
              ] },

            // Schedules — a standing recurring request. "due" is a CROSS-ACCOUNT GSI (pk=status) —
            // ReportScheduleJob sweeps it every minute for ACTIVE schedules whose nextFireAt has passed,
            // regardless of account (mirrors social's posts "schedule" GSI exactly).
            { key: "report_schedules", partitionKey: { name: "accountId", type: AttrType.STRING }, sortKey: { name: "scheduleId", type: AttrType.STRING },
              globalSecondaryIndexes: [
                  { name: "due", partitionKey: { name: "status", type: AttrType.STRING }, sortKey: { name: "nextFireAt", type: AttrType.STRING }, projection: "ALL" },
              ] },

            // `WorkQueue` governor tables (packages/services/src/WorkQueue.ts) — report's adoption, for
            // per-account fair-share so one account's many frequent/long-running reports can't starve
            // others (report-12.2). Shape is the governor's own fixed contract — not report-specific.
            { key: "wq_jobs", partitionKey: { name: "queue", type: AttrType.STRING }, sortKey: { name: "jobId", type: AttrType.STRING },
              globalSecondaryIndexes: [
                  { name: "gsi_status_account", partitionKey: { name: "statusAccountPk", type: AttrType.STRING }, sortKey: { name: "createdAt", type: AttrType.STRING }, projection: "ALL" },
              ] },
            { key: "wq_queue_config",         partitionKey: { name: "queue", type: AttrType.STRING } },
            { key: "wq_account_config",       partitionKey: { name: "accountId", type: AttrType.STRING } },
            { key: "wq_account_queue_config", partitionKey: { name: "accountId", type: AttrType.STRING }, sortKey: { name: "queue", type: AttrType.STRING } },
        ],

        // ElastiCache Serverless (Redis) — the `WorkQueue` governor's ACTIVITY store (fairness ZSET, token
        // buckets, per-minute bins); resolved via the default logical key `"cache"` (`new Cache(cloud)`).
        caches:
        [
            { key: "cache", description: "WorkQueue governor activity store (fairness/rate-limit metrics)" },
        ],

        // Submission generation work queue (+ DLQ). MAIN also drains it in-process for local/dev (mirrors
        // voice/social's queue-drain pattern), sharing the SAME processSubmission code the Lambda worker
        // below runs.
        queues:
        [
            { key: "report-generate", maxReceiveCount: 3, dlq: true, visibilityTimeoutSec: 300 },
        ],

        // Lambda workers. reportGenerateJob is vpc:true — it calls the owning services' internal S2S
        // endpoints (contact/account/campaign/email), which are only network-reachable from inside the
        // shared VPC; reportScheduleJob only reads/enqueues so it stays outside it.
        jobs:
        [
            { key: "reportGenerateJob", handler: "jobs/ReportGenerateJob.handler", runtime: JobRuntime.NODE_22,
              memoryMB: { default: 512 }, timeoutSec: 300, vpc: true,
              triggers: [ { source: "queue", ref: { service: "report", kind: ResourceKind.QUEUE, key: "report-generate", access: AccessIntent.CONSUME }, batchSize: 5 } ] },
            { key: "reportScheduleJob", handler: "jobs/ReportScheduleJob.handler", runtime: JobRuntime.NODE_22,
              memoryMB: { default: 256 }, timeoutSec: 60 },
        ],

        // EventBridge — fires reportScheduleJob every minute (sweeps due iCal schedules, report-4.1).
        eventBuses:
        [
            { key: "report-schedule", rules: [
                { key: "sweep", description: "Fire due iCal schedules", schedule: "rate(1 minute)",
                  targets: [ { service: "report", kind: ResourceKind.FUNCTION, key: "reportScheduleJob", access: AccessIntent.INVOKE } ] },
            ] },
        ],
    },

    // S2S: generators pull data from the owning services' internal list endpoints (never their DB
    // directly — report-11.2); EmailDestination sends the completion notice through email's send pipeline.
    uses:
    [
        { service: "contact",  kind: ResourceKind.SERVICE, key: "main", access: AccessIntent.INVOKE },
        { service: "account",  kind: ResourceKind.SERVICE, key: "main", access: AccessIntent.INVOKE },
        { service: "campaign", kind: ResourceKind.SERVICE, key: "main", access: AccessIntent.INVOKE },
        { service: "email",    kind: ResourceKind.SERVICE, key: "main", access: AccessIntent.INVOKE },
    ],

    tags: { domain: "core", tier: "service" },
};

export default manifest;
// eof
