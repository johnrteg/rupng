//
// app — CloudManifest: the service's AWS footprint (a resource manifest, no CDK/AWS coupling).
//
// Exported SEPARATELY from runtime code (this file imports only @repo/cloud-manifest data) so the
// /cloud CDK app can pull just the manifest at synth. /cloud turns `owns` into constructs,
// derives least-privilege IAM from `uses` + access intent, and injects resource identifiers
// back as env vars the service reads via CloudResolver. See cloud/SPECS.md.
//
// Maps the app "Service & Job topology" (SPECS.md): two ECS roles (Main + Public, the two
// security tiers), the jobs (ticket / telemetry / cache-invalidation), the notices datastore,
// feature flags (AppConfig), and web RUM.
//
import {
    ResourceManifest,
    AccessIntent, ResourceKind,
    AttrType, BillingMode, JobRuntime, ApiAuthorizer, LaunchType,
    Ports,
} from "@repo/cloud-manifest";
import { Events } from "@repo/system";   // Kafka topics = Events.Object (per-entity) / Events.Stream (analytics)

export const manifest : ResourceManifest =
{
    service     : "app",
    description : "Web BFF — bootstrap config · feature flags · notices · support glue · UI aggregation · web telemetry. Two roles: authed Main + public-edge Public.",
    tracing     : true,

    owns:
    {
        // KMS CMK encrypting app data at rest (the notices table).
        keys:
        [
            { key: "data", alias: "app-data", enableRotation: true, description: "Encrypts app data at rest (notices)" },
        ],

        // Notices / announcements datastore (app-3) — account-scoped, TTL'd.
        tables:
        [
            {
                key          : "notices",
                partitionKey : { name: "accountId", type: AttrType.STRING },
                sortKey      : { name: "noticeId",  type: AttrType.STRING },
                billingMode  : BillingMode.ON_DEMAND,
                kmsKey       : "data",
                ttlAttribute : "expiresAt",
            },
        ],

        // Work queues for the jobs (auto-DLQ): ticket alerts (app-4.3) + telemetry intake (app-5.2).
        queues:
        [
            { key: "tickets",   maxReceiveCount: 5, dlq: true, visibilityTimeoutSec: 60 },   // -> AppTicketJob
            { key: "telemetry", maxReceiveCount: 3, dlq: true, visibilityTimeoutSec: 30 },   // -> AppTelemetryJob
        ],

        // Runtime config + feature flags (app-1 bootstrap / app-2 flags). The "web" profile is the PUBLIC
        // bootstrap blob (GetBootstrap.Config) served by the public role; "settings"/"flags" are the
        // (separate) authed AppService config + flag set, wired later.
        appConfig:
        [
            { key: "config", application: "app", profiles: [ { key: "settings" }, { key: "flags", type: "feature_flags" }, { key: "web" } ] },
        ],

        // Web real-user monitoring (app-5 telemetry / RUM).
        rum:
        [
            { key: "web", domain: "app.rumbleup.com", sessionSampleRate: 0.1 },
        ],

        // The two ECS Fargate ROLES — the SAME image (root Dockerfile, APP_NAME=app); SERVICE_ROLE
        // selects the role and PORT is its slot in the APP port block (@repo/services Ports: main 8100 /
        // public 8101). Internal ALBs fronted by the API Gateway; the Public tier scales independently
        // (the "two security tiers" split) so a telemetry/bootstrap flood can't starve the authed app.
        services:
        [
            {
                key             : "main",
                launchType      : LaunchType.FARGATE,
                containerPort   : Ports.APP.MAIN,             // same constant AppService.PORT[main] uses — can't drift
                healthCheckPath : "/health",
                environment     : { SERVICE_ROLE: "main", LOG_LEVEL: "info" },
                sizing          : { default: { cpu: 1, memory: 2 },
                                    production: { cpu: 4, memory: 5 } },
                autoscaling     : { default: { min: 1, max: 2, start: 1, targetCpuPercent: 60 },
                                    production: { min: 2, max: 8, start: 2, targetCpuPercent: 60 } },
                loadBalancer    : { public: false },
            },
            {
                key             : "public",
                launchType      : LaunchType.FARGATE,
                containerPort   : Ports.APP.PUBLIC,           // same constant AppService.PORT[public] uses — can't drift
                healthCheckPath : "/health",
                environment     : { SERVICE_ROLE: "public", LOG_LEVEL: "info" },
                sizing          : { default: { cpu: 1, memory: 2 },
                                    production: { cpu: 4, memory: 5 } },
                autoscaling     : { default: { min: 1, max: 2, start: 1, targetCpuPercent: 60 },
                                    production: { min: 3, max: 20, start: 3, targetCpuPercent: 60 } },
                loadBalancer    : { public: false },
            },
        ],

        // The jobs (Lambda workers). Handlers are bundled from the app service (jobs/* entries) when
        // scaffolded; declared here as the footprint + their triggers (queue-driven; cache-invalidation
        // is change-event driven via the subscribe binding below).
        jobs:
        [
            {
                key        : "ticket",
                handler    : "jobs/AppTicketJob.handler",
                runtime    : JobRuntime.NODE_22,
                timeoutSec : 30,
                triggers   : [ { source: "queue", ref: { service: "app", kind: ResourceKind.QUEUE, key: "tickets", access: AccessIntent.CONSUME }, batchSize: 10 } ],
            },
            {
                key        : "telemetry",
                handler    : "jobs/AppTelemetryJob.handler",
                runtime    : JobRuntime.NODE_22,
                timeoutSec : 30,
                triggers   : [ { source: "queue", ref: { service: "app", kind: ResourceKind.QUEUE, key: "telemetry", access: AccessIntent.CONSUME }, batchSize: 10 } ],
            },
            {
                key        : "cacheInvalidation",
                handler    : "jobs/AppCacheInvalidationJob.handler",
                runtime    : JobRuntime.NODE_22,
                timeoutSec : 30,
            },
        ],

        // The BFF API gateway (the front door). Public + authed routes share it; the BFF enforces
        // session auth itself, so the gateway passes through (authorizer NONE) — routes get generated
        // from the public RestfulEndpoint defs once they exist (like the demo's apiEndpoints(...)).
        api:
        {
            key        : "api",
            authorizer : ApiAuthorizer.NONE,
            cors       : true,
            throttle   : {  default: { rateLimit: 100, burstLimit: 200 },
                            production: { rateLimit: 1000, burstLimit: 2000 } },
            // Public, unauthenticated edge routes. /version (and /health) are inherited by every
            // service from the shared framework; declaring them here gives them a gateway route so
            // the deploy console can read the live version per environment. (Authed app routes will
            // be generated from the public RestfulEndpoint defs once that wiring lands.)
            endpoints  :
            [
                { method: "GET", path: "/version", public: true, authRequired: false },
                { method: "GET", path: "/health",  public: true, authRequired: false },
            ],
        },
    },

    // Kafka pub/sub against the shared cluster:
    //   • publish web behavior/telemetry → the analytics ingestion stream (the AppTelemetryJob route)
    //   • subscribe to the SPECIFIC entity topics whose changes bust app caches → AppCacheInvalidationJob.
    //     (e.g. media.asset for cached assets; add the help/content entity topic when that service lands.)
    publishes:  [ { topic: Events.Stream.BEHAVIOR } ],
    subscribes: [
        { topic: Events.Object.MEDIA_ASSET,     consumerGroup: "app-cache-invalidation" },
        // BFF read-model warming — the tail of the sign-up chain (account provisioned, new identity).
        { topic: Events.Object.ACCOUNT_ACCOUNT, consumerGroup: "app-readmodel" },
        { topic: Events.Object.AUTH_USER,       consumerGroup: "app-readmodel" },
    ],

    tags: { domain: "core", tier: "bff" },
};

export default manifest;
// eof
