//
// analytics — CloudManifest: the service's AWS footprint (resource manifest, no CDK/AWS coupling).
// See apps/core/analytics/SPECS.md for the full design + the gap register for what's deferred.
//
// Shaped unusually per SPECS.md "Service & Job topology": ONE thin HTTP role (`main` —
// AnalyticsQueryService) + ECS WORKER roles (`ingest` today; `rollup` joins in a later phase) that
// run as long-lived `Consumer`s (not Lambda Jobs — the platform has no Lambda↔MSK event-source-
// mapping; see AnalyticsConsumer.ts for why). A worker role omits `containerPort`/`loadBalancer` —
// this is the FIRST service to use that shape on this platform.
//
// MVP cut (documented, not silently scoped down): the raw lake is plain JSON, not Parquet, and
// there's no Kafka Connect / Athena / Glue — none of that exists anywhere on the platform yet
// (report hit the same wall — see its CloudManifest). Rollups (a `rollup` worker + table) and the
// Query API's real endpoints land in later phases.
//
import {
    ResourceManifest,
    ApiAuthorizer, LaunchType,
    AttrType,
    Ports,
    JobRuntime, ResourceKind, AccessIntent,
} from "@repo/cloud-manifest";
import { Events } from "@repo/system";

export const manifest : ResourceManifest =
{
    service     : "analytics",
    description : "The platform's business/engagement plane — the centralized event history of what happens to a message after it leaves us, and the aggregate queries/dashboards built on it.",
    tracing     : true,

    owns:
    {
        // ONE HTTP role (the Query API) + ONE ECS worker role today (the ingest consumer). Both
        // FARGATE; the worker declares no containerPort/loadBalancer — it's not reachable, it pulls
        // its own work off Kafka.
        services:
        [
            {
                key             : "main",
                launchType      : LaunchType.FARGATE,
                containerPort   : Ports.ANALYTICS.MAIN,
                healthCheckPath : "/health",
                environment     : { SERVICE_ROLE: "main", LOG_LEVEL: "info" },
                sizing          : { default: { cpu: 1, memory: 2 }, production: { cpu: 2, memory: 4 } },
                autoscaling     : { default: { min: 1, max: 2, start: 1, targetCpuPercent: 60 },
                                    production: { min: 2, max: 6, start: 2, targetCpuPercent: 60 } },
                loadBalancer    : { public: false },
            },
            {
                key             : "ingest",
                launchType      : LaunchType.FARGATE,
                environment     : { SERVICE_ROLE: "ingest", LOG_LEVEL: "info" },
                sizing          : { default: { cpu: 1, memory: 2 }, production: { cpu: 2, memory: 4 } },
                autoscaling     : { default: { min: 1, max: 1, start: 1, targetCpuPercent: 70 },
                                    production: { min: 1, max: 3, start: 1, targetCpuPercent: 70 } },
            },
            {
                key             : "rollup",
                launchType      : LaunchType.FARGATE,
                environment     : { SERVICE_ROLE: "rollup", LOG_LEVEL: "info" },
                sizing          : { default: { cpu: 1, memory: 2 }, production: { cpu: 2, memory: 4 } },
                autoscaling     : { default: { min: 1, max: 1, start: 1, targetCpuPercent: 70 },
                                    production: { min: 1, max: 3, start: 1, targetCpuPercent: 70 } },
            },
        ],

        // API gateway. The service enforces auth itself → authorizer NONE. /health + /version are
        // inherited; the real Query API routes (analytics-5/7) land in a later phase.
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

        // dedup — the ingest consumer's idempotency claim marker, keyed on a stable event id
        // ((provider, providerEventId) for engagement events; the producer-assigned eventId for
        // behavior events — analytics-1.3/gap #7). TTL'd — a claim only needs to outlive the
        // realistic at-least-once redelivery window, not forever.
        // rollups — one row per unique (accountId, channel, campaignId, eventType, granularity,
        // periodStart) bucket (analytics-4.x), keyed accountId/sk (AnalyticsRollupConsumer.sortKey).
        // rollup_dedup — the rollup consumer's OWN claim table (analytics-4.5/gap #7); separate from
        // `dedup` because it's a different consumer group reading the same streams — sharing one
        // claim table would make the rollup claim collide with the (already-won) ingest claim.
        tables:
        [
            { key: "dedup", partitionKey: { name: "dedupKey", type: AttrType.STRING }, ttlAttribute: "expiresAt" },
            { key: "rollup_dedup", partitionKey: { name: "dedupKey", type: AttrType.STRING }, ttlAttribute: "expiresAt" },
            { key: "rollups", partitionKey: { name: "accountId", type: AttrType.STRING }, sortKey: { name: "sk", type: AttrType.STRING } },
        ],

        // raw — the append-only event lake (analytics-3.1). MVP: plain JSON under S3.Domain.EVENTS
        // (account/channel/date), not Parquet — see the file header + SPECS gap register.
        buckets:
        [
            { key: "raw" },
        ],

        // The reprocess/backfill request queue (analytics-3.7/4.4) — POST /analytics/reprocess
        // enqueues here; AnalyticsBackfillJob drains it.
        queues:
        [
            { key: "analytics-backfill", maxReceiveCount: 3, dlq: true, visibilityTimeoutSec: 300 },
        ],

        // Lambda workers — see SPECS.md "Service & Job topology". Distinct from the `ingest`/`rollup`
        // ECS Consumer roles above: a Job is invoke-work-exit (triggered by this queue), not a
        // long-running Kafka firehose reader.
        jobs:
        [
            { key: "backfill", handler: "jobs/AnalyticsBackfillJob.handler", runtime: JobRuntime.NODE_22,
              memoryMB: { default: 512 }, timeoutSec: 300,
              triggers: [ { source: "queue", ref: { service: "analytics", kind: ResourceKind.QUEUE, key: "analytics-backfill", access: AccessIntent.CONSUME }, batchSize: 1 } ] },
        ],
    },

    // Kafka — the ingest consumer subscribes to BOTH analytics ingestion streams (analytics-1.5).
    subscribes:
    [
        { topic: Events.Stream.ENGAGEMENT, consumerGroup: "analytics-ingest" },
        { topic: Events.Stream.BEHAVIOR,   consumerGroup: "analytics-ingest" },
    ],

    tags: { domain: "core", tier: "service" },
};

export default manifest;
// eof
