//
// audit — CloudManifest: the service's AWS footprint (resource manifest, no CDK/AWS coupling).
//
// The platform's single, immutable, action-level audit trail (SPECS.md). ONE ECS role — the
// /audit/* API (`AuditQueryService`: read + admin ONLY, no event-write endpoint) — plus FOUR Lambda
// jobs. Writes are queue-only: every OTHER service's `Application.audit()` enqueues to the
// PLATFORM-shared `platform-audit-events` queue (provisioned once in `PlatformStack`, NOT here — see
// `owns.jobs[].triggers` below, which binds against that imported queue rather than an `owns.queues`
// entry of its own, to avoid a naming collision with the one true platform queue).
//
import {
    ResourceManifest,
    ApiAuthorizer, LaunchType,
    AttrType, StreamViewType,
    Ports,
    JobRuntime, ResourceKind, AccessIntent,
} from "@repo/cloud-manifest";

export const manifest : ResourceManifest =
{
    service     : "audit",
    description : "The platform's single, immutable, action-level audit trail — WORM ingestion + retention/legal-hold + tenant/staff query.",
    tracing     : true,

    owns:
    {
        // The ECS Fargate role — the /audit/* API. Read + admin ONLY (query, export, legal-hold, config,
        // health) — there is deliberately no event-WRITE endpoint (audit-7.2); events arrive only via SQS.
        services:
        [
            {
                key             : "main",
                launchType      : LaunchType.FARGATE,
                containerPort   : Ports.AUDIT.MAIN,
                healthCheckPath : "/health",
                environment     : { SERVICE_ROLE: "main", LOG_LEVEL: "info" },
                sizing          : { default: { cpu: 1, memory: 2 }, production: { cpu: 2, memory: 4 } },
                autoscaling     : { default: { min: 1, max: 2, start: 1, targetCpuPercent: 60 },
                                    production: { min: 2, max: 6, start: 2, targetCpuPercent: 60 } },
                loadBalancer    : { public: false },
            },
        ],

        // API gateway. The service enforces auth itself → authorizer NONE. /health + /version are
        // inherited; resource routes are generated from the public RestfulEndpoint defs in cloud/src/app.ts.
        api:
        {
            key        : "api",
            authorizer : ApiAuthorizer.NONE,
            cors       : true,
            throttle   : { default: { rateLimit: 100, burstLimit: 200 },
                           production: { rateLimit: 500, burstLimit: 1000 } },
            endpoints  :
            [
                { method: "GET", path: "/version", public: true, authRequired: false },
                { method: "GET", path: "/health",  public: true, authRequired: false },
            ],
        },

        // Runtime config (AppConfig) — retention tiers + tamper-evidence toggle (audit-4.1), tunable
        // without a redeploy.
        appConfig:
        [
            { key: "config", application: "audit", profiles: [ { key: "settings" } ] },
        ],

        // DynamoDB.
        //   events       — the HOT, queryable store (PK accountId, SK at#seq — see AuditSinkJob's sk
        //                  format). `stream: NEW_IMAGE` feeds AuditArchiveJob's mirror-to-S3 (audit-2.3).
        //   legal_holds  — active/released litigation freezes (audit-4.2).
        tables:
        [
            { key: "events", partitionKey: { name: "accountId", type: AttrType.STRING }, sortKey: { name: "sk", type: AttrType.STRING },
              stream: StreamViewType.NEW_IMAGE, pointInTimeRecovery: true },
            { key: "legal_holds", partitionKey: { name: "accountId", type: AttrType.STRING }, sortKey: { name: "holdId", type: AttrType.STRING } },
        ],

        // S3 — the WORM archive (audit-3.1). Object Lock (compliance mode) forces versioning + can only be
        // set at bucket creation (see BucketSpec.objectLock / ServiceStack.makeBucket). `retentionDays`
        // matches the longest configured retention tier (financial, per SPECS' example — 7 years); a
        // shorter tier's records simply outlive their AuditRetentionJob-driven HOT-store expiry while the
        // ARCHIVE copy stays locked for the bucket's own (longer) default.
        buckets:
        [
            { key: "archive", objectLock: { mode: "compliance", retentionDays: 2555 } },   // ~7 years
        ],

        // Lambda workers — see SPECS.md "Service & Job topology". `auditSinkJob`'s trigger binds to the
        // PLATFORM-owned `platform-audit-events` queue (service: "platform" — NOT an `owns.queues` entry
        // of THIS manifest, see the file header); `auditArchiveJob`'s binds to the `events` table's stream.
        jobs:
        [
            { key: "auditSinkJob", handler: "jobs/AuditSinkJob.handler", runtime: JobRuntime.NODE_22,
              memoryMB: { default: 256 }, timeoutSec: 30,
              triggers: [ { source: "queue", ref: { service: "platform", kind: ResourceKind.QUEUE, key: "audit-events", access: AccessIntent.CONSUME }, batchSize: 10 } ] },
            { key: "auditArchiveJob", handler: "jobs/AuditArchiveJob.handler", runtime: JobRuntime.NODE_22,
              memoryMB: { default: 512 }, timeoutSec: 60,
              triggers: [ { source: "table", ref: { service: "audit", kind: ResourceKind.TABLE, key: "events", access: AccessIntent.CONSUME }, batchSize: 100 } ] },
            { key: "auditRetentionJob", handler: "jobs/AuditRetentionJob.handler", runtime: JobRuntime.NODE_22,
              memoryMB: { default: 256 }, timeoutSec: 300 },
        ],

        // EventBridge — the daily defensible-expiry sweep (audit-4.1). Must come after `jobs` (the target
        // is resolved by Lambda function name — ServiceStack's fixed `owns` processing order handles this).
        eventBuses:
        [
            { key: "audit-retention", rules: [
                { key: "sweep", description: "Defensible, logged expiry by retention tier (legal hold overrides)", schedule: "rate(1 day)",
                  targets: [ { service: "audit", kind: ResourceKind.FUNCTION, key: "auditRetentionJob", access: AccessIntent.INVOKE } ] },
            ] },
        ],
    },

    tags: { domain: "core", tier: "service" },
};

export default manifest;
// eof
