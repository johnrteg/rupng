//
// social — CloudManifest: the service's AWS footprint (resource manifest, no CDK/AWS coupling).
//
// DynamoDB is the source of truth (connections + posts + inbox + review threads); the /social/* API
// is one ECS role (MAIN) — including webhook intake + the data-deletion callback for now: the
// platform's API Gateway integration (`ServiceStack.makeApi`) only backs ONE ECS role's ALB per
// manifest (the last one created wins `_albListener`), so a dedicated scale-independent
// `SocialWebhookService` role (SPECS.md's intent) needs multi-ALB gateway routing support first — a
// platform-level gap, not specific to social. MAIN also drains the publish queue in-process for
// local/dev.
//
import {
    ResourceManifest,
    ApiAuthorizer, LaunchType,
    AttrType,
    Ports,
    JobRuntime, ResourceKind, AccessIntent,
} from "@repo/cloud-manifest";

export const manifest : ResourceManifest =
{
    service     : "social",
    description : "Social-media publish + inbox — connects the account's own social destinations (BYO OAuth via marketplace), composes + publishes posts, and surfaces the inbound inbox (DMs/comments/mentions).",
    tracing     : true,

    owns:
    {
        // The ECS Fargate role — the /social/* API (root Dockerfile, APP_NAME=social; SERVICE_ROLE=main;
        // PORT = its slot in the SOCIAL block, @repo/cloud-manifest Ports: main 8220).
        services:
        [
            {
                key             : "main",
                launchType      : LaunchType.FARGATE,
                containerPort   : Ports.SOCIAL.MAIN,
                healthCheckPath : "/health",
                environment     : { SERVICE_ROLE: "main", LOG_LEVEL: "info" },
                sizing          : { default: { cpu: 1, memory: 2 }, production: { cpu: 2, memory: 4 } },
                autoscaling     : { default: { min: 1, max: 2, start: 1, targetCpuPercent: 60 },
                                    production: { min: 2, max: 6, start: 2, targetCpuPercent: 60 } },
                loadBalancer    : { public: false },
            },
        ],

        // API gateway (the front door). The service enforces auth itself → authorizer NONE. /health + /version
        // are inherited; resource routes are generated from the public RestfulEndpoint defs in cloud/src/app.ts.
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

        // Runtime config (AppConfig) — the social service's non-secret operational policy (poll cadence,
        // refresh cooldown, approvals default, per-network quota), tunable without a redeploy.
        appConfig:
        [
            { key: "config", application: "social", profiles: [ { key: "settings" } ] },
        ],

        // DynamoDB — the SoT for connections, posts, the inbox, and review threads.
        tables:
        [
            // "byId" is a CROSS-ACCOUNT GSI (pk=id) — webhook intake resolves a payload's platform-native
            // page/business id (== our connectionId, under the adapters' publish-side simplification —
            // see FacebookAdapter/LinkedInAdapter) back to its owning account without foreknowledge.
            { key: "connections", partitionKey: { name: "accountId", type: AttrType.STRING }, sortKey: { name: "id", type: AttrType.STRING },
              globalSecondaryIndexes: [
                  { name: "status", partitionKey: { name: "accountId", type: AttrType.STRING }, sortKey: { name: "status", type: AttrType.STRING }, projection: "ALL" },
                  { name: "byId",   partitionKey: { name: "id", type: AttrType.STRING }, projection: "ALL" },
              ] },
            // "schedule" is a CROSS-ACCOUNT GSI (pk=status) — SocialScheduleJob sweeps it for due
            // SCHEDULED posts regardless of account, ordered by scheduleAt.
            { key: "posts", partitionKey: { name: "accountId", type: AttrType.STRING }, sortKey: { name: "id", type: AttrType.STRING },
              globalSecondaryIndexes: [
                  { name: "status",   partitionKey: { name: "accountId", type: AttrType.STRING }, sortKey: { name: "status", type: AttrType.STRING }, projection: "ALL" },
                  { name: "schedule", partitionKey: { name: "status", type: AttrType.STRING }, sortKey: { name: "scheduleAt", type: AttrType.STRING }, projection: "ALL" },
              ] },
            { key: "published_posts", partitionKey: { name: "postId", type: AttrType.STRING }, sortKey: { name: "target", type: AttrType.STRING } },
            { key: "post_comments", partitionKey: { name: "postId", type: AttrType.STRING }, sortKey: { name: "id", type: AttrType.STRING } },
            { key: "post_audit", partitionKey: { name: "postId", type: AttrType.STRING }, sortKey: { name: "seq", type: AttrType.NUMBER } },
            // per-post monotonic sequence counters (one item per postId, attr `n`) — the source of
            // post_audit's `seq` (mirrors campaign's campaign_counters pattern).
            { key: "post_counters", partitionKey: { name: "postId", type: AttrType.STRING }, sortKey: { name: "kind", type: AttrType.STRING } },
            // TTL'd — inbound isn't kept forever (InboundPipeline sets `ttl` ~90 days out).
            { key: "inbox", partitionKey: { name: "accountId", type: AttrType.STRING }, sortKey: { name: "id", type: AttrType.STRING }, ttlAttribute: "ttl" },
        ],

        // SQS (+ DLQ). MAIN also drains social-publish in-process for local/dev (mirrors media's
        // queue-drain pattern), sharing the same SocialPipeline code the Lambda worker below runs.
        //   social-publish — the publish pipeline's work queue.
        //   social-inbound — fed by MAIN's webhook intake (verified + parsed) and by SocialPollJob;
        //                    SocialInboundJob normalizes + tags + scores + stores.
        //   social-poll    — on-demand Refresh requests (PostInboxRefresh enqueues; SocialPollJob drains).
        queues:
        [
            { key: "social-publish", maxReceiveCount: 5, dlq: true, visibilityTimeoutSec: 60 },
            { key: "social-inbound", maxReceiveCount: 5, dlq: true, visibilityTimeoutSec: 30 },
            { key: "social-poll",    maxReceiveCount: 3, dlq: true, visibilityTimeoutSec: 60 },
        ],

        // Lambda workers. vpc:true on socialPublishWorker/socialPollJob — both resolve a marketplace
        // token over MARKETPLACE_INTERNAL_URL (injected below from `uses`), which is only network-
        // reachable from inside the shared VPC; socialScheduleJob/socialInboundJob never call
        // marketplace (schedule only reads/enqueues; inbound only normalizes + stores) so they stay
        // outside it.
        jobs:
        [
            { key: "socialPublishWorker", handler: "jobs/SocialPublishWorker.handler", runtime: JobRuntime.NODE_22,
              memoryMB: { default: 512 }, timeoutSec: 30, vpc: true,
              triggers: [ { source: "queue", ref: { service: "social", kind: ResourceKind.QUEUE, key: "social-publish", access: AccessIntent.CONSUME }, batchSize: 5 } ] },
            { key: "socialScheduleJob", handler: "jobs/SocialScheduleJob.handler", runtime: JobRuntime.NODE_22,
              memoryMB: { default: 256 }, timeoutSec: 60 },
            { key: "socialInboundJob", handler: "jobs/SocialInboundJob.handler", runtime: JobRuntime.NODE_22,
              memoryMB: { default: 256 }, timeoutSec: 30,
              triggers: [ { source: "queue", ref: { service: "social", kind: ResourceKind.QUEUE, key: "social-inbound", access: AccessIntent.CONSUME }, batchSize: 10 } ] },
            { key: "socialPollJob", handler: "jobs/SocialPollJob.handler", runtime: JobRuntime.NODE_22,
              memoryMB: { default: 256 }, timeoutSec: 60, vpc: true,
              triggers: [ { source: "queue", ref: { service: "social", kind: ResourceKind.QUEUE, key: "social-poll", access: AccessIntent.CONSUME }, batchSize: 5 } ] },
        ],

        // EventBridge. A scheduled rule's target is resolved by Lambda function name
        // (ServiceStack.makeEventBus), so this must come after `jobs` for the function to already
        // exist when the rule is built (it does — see owns' fixed processing order in ServiceStack.ts).
        //   sweep      — fires SocialScheduleJob every minute (due SCHEDULED posts).
        //   poll-sweep — fires SocialPollJob every 15 min (SocialConfig.poll.cadenceSeconds' default) with
        //                no message body; the job's own handler sweeps all due pull-only connections
        //                (distinct from its on-demand path, which arrives via the social-poll queue with
        //                a specific connectionId).
        eventBuses:
        [
            { key: "social-schedule", rules: [
                { key: "sweep", description: "Fire due SCHEDULED posts", schedule: "rate(1 minute)",
                  targets: [ { service: "social", kind: ResourceKind.FUNCTION, key: "socialScheduleJob", access: AccessIntent.INVOKE } ] },
                { key: "poll-sweep", description: "Poll due pull-only connections", schedule: "rate(15 minutes)",
                  targets: [ { service: "social", kind: ResourceKind.FUNCTION, key: "socialPollJob", access: AccessIntent.INVOKE } ] },
            ] },
        ],
    },

    // marketplace's internal ALB — resolves to a MARKETPLACE_INTERNAL_URL env var on every social
    // compute target placed in the VPC (ECS `main` role + the two `vpc:true` jobs), injected BEFORE
    // they're created (see ServiceStack's early `injectServiceUrl` pass). Requires `marketplaceManifest`
    // to precede `socialManifest` in cloud/src/app.ts's `manifests[]` (it does).
    uses:
    [
        { service: "marketplace", kind: ResourceKind.SERVICE, key: "main", access: AccessIntent.INVOKE },
    ],

    tags: { domain: "core", tier: "service" },
};

export default manifest;
// eof
