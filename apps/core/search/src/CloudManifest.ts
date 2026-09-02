//
// search — CloudManifest: the service's AWS footprint (resource manifest, no CDK/AWS coupling).
// See apps/core/search/SPECS.md for the full design + the gap register for what's deferred.
//
// Shaped like analytics per SPECS.md "Service & Job topology" (updated): ONE thin HTTP role (`main`
// — SearchQueryService) + ONE ECS WORKER role (`indexer`) that runs as a long-lived `Consumer` (not a
// Lambda `Job` — the platform has no Lambda↔MSK event-source-mapping; see SearchConsumer.ts for why).
// The worker role omits `containerPort`/`loadBalancer` — same shape analytics' `ingest` role uses.
//
// MVP cut (documented, not silently scoped down): no index-mapping/analyzer-creation step exists yet
// (SearchService.textClause's header comment), and `SearchReindexJob` is an honest stub (its own file
// header) — the per-type owning-service "list all" read path it needs doesn't exist anywhere yet.
//
import {
    ResourceManifest,
    ApiAuthorizer, LaunchType,
    Ports,
    JobRuntime, ResourceKind, AccessIntent,
} from "@repo/cloud-manifest";
import { Events } from "@repo/system";

export const manifest : ResourceManifest =
{
    service     : "search",
    description : "The platform's global content-search plane — text + filters -> ranked results across campaigns/contacts/segments/emails, always account- + role-filtered. Index-then-query over OpenSearch, fed by owning services' change events, Redis-cached.",
    tracing     : true,

    owns:
    {
        // ONE HTTP role (the query API) + ONE ECS worker role (the indexer). Both FARGATE; the worker
        // declares no containerPort/loadBalancer — it's not reachable, it pulls its own work off Kafka.
        services:
        [
            {
                key             : "main",
                launchType      : LaunchType.FARGATE,
                containerPort   : Ports.SEARCH.MAIN,
                healthCheckPath : "/health",
                environment     : { SERVICE_ROLE: "main", LOG_LEVEL: "info" },
                sizing          : { default: { cpu: 1, memory: 2 }, production: { cpu: 2, memory: 4 } },
                autoscaling     : { default: { min: 1, max: 2, start: 1, targetCpuPercent: 60 },
                                    production: { min: 2, max: 6, start: 2, targetCpuPercent: 60 } },
                loadBalancer    : { public: false },
            },
            {
                key             : "indexer",
                launchType      : LaunchType.FARGATE,
                environment     : { SERVICE_ROLE: "indexer", LOG_LEVEL: "info" },
                sizing          : { default: { cpu: 1, memory: 2 }, production: { cpu: 2, memory: 4 } },
                autoscaling     : { default: { min: 1, max: 1, start: 1, targetCpuPercent: 70 },
                                    production: { min: 1, max: 3, start: 1, targetCpuPercent: 70 } },
            },
        ],

        // API gateway. The service enforces auth itself → authorizer NONE. /health + /version are
        // inherited; the real query-path routes are appended in cloud/src/app.ts (apiEndpoints).
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

        // the "config/settings" AppConfig profile GetSearchConfig/PutSearchConfig read/write
        // (indexedTypes, weights, cacheTtlSeconds, audit posture) — same one-profile shape as voice.
        appConfig:
        [
            { key: "config", application: "search", profiles: [ { key: "settings" } ] },
        ],

        // the recent-search result cache (search-2.2), resolved via the default logical key `"cache"`
        // (`new Cache(cloud)`) — same shape as voice's WorkQueue-governor cache.
        caches:
        [
            { key: "cache", description: "Recent-search result cache (query+account+role+filters, short TTL)" },
        ],

        // the reindex/backfill request queue (search-1.4) — POST /search/internal/reindex enqueues
        // here; SearchReindexJob drains it (today, an honest stub — see its file header).
        queues:
        [
            { key: "search-reindex", maxReceiveCount: 3, dlq: true, visibilityTimeoutSec: 300 },
        ],

        // Lambda worker — see SPECS.md "Service & Job topology". Distinct from the `indexer` ECS
        // Consumer role above: a Job is invoke-work-exit (triggered by this queue), not a long-running
        // Kafka firehose reader.
        jobs:
        [
            { key: "reindex", handler: "jobs/SearchReindexJob.handler", runtime: JobRuntime.NODE_22,
              memoryMB: { default: 512 }, timeoutSec: 300,
              triggers: [ { source: "queue", ref: { service: "search", kind: ResourceKind.QUEUE, key: "search-reindex", access: AccessIntent.CONSUME }, batchSize: 1 } ] },
        ],
    },

    // the platform-shared OpenSearch cluster (PlatformManifest.searchCluster, cloud/src/app.ts) —
    // both the query role (read) and the indexer role (write) resolve it via the SAME logical key
    // `"search"` (`new Search(cloud)`'s default), so one grant covers both.
    uses:
    [
        { service: "search", kind: ResourceKind.SEARCH, key: "search", access: AccessIntent.READ_WRITE },
    ],

    // Kafka — the indexer consumer subscribes to every v1 searchable-type's change stream (search-4.1/4.2).
    subscribes:
    [
        { topic: Events.Object.CONTACT_CONTACT,   consumerGroup: "search-indexer" },
        { topic: Events.Object.CONTACT_SEGMENT,   consumerGroup: "search-indexer" },
        { topic: Events.Object.CAMPAIGN_CAMPAIGN, consumerGroup: "search-indexer" },
        { topic: Events.Object.EMAIL_TEMPLATE,    consumerGroup: "search-indexer" },
        { topic: Events.Object.EMAIL_MESSAGE,     consumerGroup: "search-indexer" },
    ],

    tags: { domain: "core", tier: "service" },
};

export default manifest;
// eof
