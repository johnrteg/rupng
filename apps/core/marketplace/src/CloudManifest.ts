//
// marketplace — CloudManifest: the service's AWS footprint (resource manifest, no CDK/AWS coupling).
//
// The integration control plane: DynamoDB holds the catalog + per-account installations; the
// credential vault + OAuth broker (grant/refresh) live behind `@repo/oauth`, not this manifest, since
// the default broker (Nango) manages its own storage. Covers: the S2S internal API social's
// connections flow depends on, the account-facing lifecycle API (enable/pause/resume/uninstall/
// connect/reauth), periodic connection-health probing, a provider-agnostic outbound-action worker
// (routes through the OAuth broker's proxy — no per-connector SDK needed for a plain REST call), and
// (as of Shopify — the first concrete connector, `src/connectors/`) inbound webhook intake +
// per-connector normalize (`MarketplaceConnectorJob`). Webhook intake is a route on the MAIN role, not
// a dedicated `MarketplaceWebhookService`, for the same one-ALB-per-manifest reason social's is too.
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
    service     : "marketplace",
    description : "The integration control plane — catalog, per-account installations, and the credential vault/OAuth broker. Owns what's enabled + the connection lifecycle; delegates talking-to-3rd-parties to the connector runtime.",
    tracing     : true,

    owns:
    {
        // The ECS Fargate role — the /marketplace/* internal API (root Dockerfile, APP_NAME=marketplace;
        // SERVICE_ROLE=main; PORT = its slot in the MARKETPLACE block, @repo/cloud-manifest Ports: main 8170).
        services:
        [
            {
                key             : "main",
                launchType      : LaunchType.FARGATE,
                containerPort   : Ports.MARKETPLACE.MAIN,
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

        // DynamoDB — the SoT for the catalog + installations. `catalog` is platform-global (PK
        // integrationId); `installations` is PK installationId (the only key an S2S caller has — the
        // account-facing API only knows accountId, hence the "byAccount" GSI). The installations key
        // shape is a deliberate simplification of SPECS.md's `pk=ACCOUNT#<accountId> sk=INTEG#<integrationId>`
        // for the internal-only slice; the account-facing browse/enable API can re-key onto that shape
        // (or keep this + the GSI) when it lands.
        tables:
        [
            { key: "catalog", partitionKey: { name: "integrationId", type: AttrType.STRING },
              globalSecondaryIndexes: [
                  { name: "category", partitionKey: { name: "category", type: AttrType.STRING }, sortKey: { name: "integrationId", type: AttrType.STRING }, projection: "ALL" },
              ] },
            { key: "installations", partitionKey: { name: "installationId", type: AttrType.STRING },
              globalSecondaryIndexes: [
                  { name: "byAccount",    partitionKey: { name: "accountId", type: AttrType.STRING }, sortKey: { name: "status", type: AttrType.STRING }, projection: "ALL" },
                  // CROSS-ACCOUNT (pk=externalRef) — webhook intake resolves a payload's provider-native
                  // connection id (e.g. a Shopify shop domain) back to its owning installation without
                  // foreknowledge; mirrors social's `connections.byId`.
                  { name: "byExternalRef", partitionKey: { name: "externalRef", type: AttrType.STRING }, projection: "ALL" },
              ] },
            { key: "installation_audit", partitionKey: { name: "installationId", type: AttrType.STRING }, sortKey: { name: "seq", type: AttrType.NUMBER } },
            // per-installation monotonic sequence counters (mirrors campaign/social's counter pattern).
            { key: "installation_counters", partitionKey: { name: "installationId", type: AttrType.STRING }, sortKey: { name: "kind", type: AttrType.STRING } },
            // usage metering (marketplace-8.0) — PK accountId, SK meterKey (`<integrationId>#<instanceId ?? "_">#<period>`).
            { key: "usage_meters", partitionKey: { name: "accountId", type: AttrType.STRING }, sortKey: { name: "meterKey", type: AttrType.STRING } },
        ],

        // SQS (+ DLQ) — the outbound-action work queue (marketplace-4.2, fed by PostInternalAction) and
        // the inbound webhook-intake work queue (marketplace-5.0, fed by PostMarketplaceWebhookImpl).
        queues:
        [
            { key: "marketplace-actions",   maxReceiveCount: 5, dlq: true, visibilityTimeoutSec: 60 },
            { key: "marketplace-connector", maxReceiveCount: 5, dlq: true, visibilityTimeoutSec: 30 },
        ],

        // Lambda workers. No vpc:true on any — all only talk to their own DynamoDB + the OAuth broker
        // (Nango, over the public internet), never a VPC-internal ALB call.
        jobs:
        [
            { key: "marketplaceHealthJob", handler: "jobs/MarketplaceHealthJob.handler", runtime: JobRuntime.NODE_22,
              memoryMB: { default: 256 }, timeoutSec: 120 },
            { key: "marketplaceActionJob", handler: "jobs/MarketplaceActionJob.handler", runtime: JobRuntime.NODE_22,
              memoryMB: { default: 256 }, timeoutSec: 30,
              triggers: [ { source: "queue", ref: { service: "marketplace", kind: ResourceKind.QUEUE, key: "marketplace-actions", access: AccessIntent.CONSUME }, batchSize: 5 } ] },
            { key: "marketplaceConnectorJob", handler: "jobs/MarketplaceConnectorJob.handler", runtime: JobRuntime.NODE_22,
              memoryMB: { default: 256 }, timeoutSec: 30,
              triggers: [ { source: "queue", ref: { service: "marketplace", kind: ResourceKind.QUEUE, key: "marketplace-connector", access: AccessIntent.CONSUME }, batchSize: 5 } ] },
        ],

        // EventBridge — fires the health sweep every 30 minutes. Must come after `jobs` for the
        // function to already exist when the rule is built (see ServiceStack's fixed processing order).
        eventBuses:
        [
            { key: "marketplace-health", rules: [
                { key: "sweep", description: "Probe ACTIVE/NEEDS_AUTH installations", schedule: "rate(30 minutes)",
                  targets: [ { service: "marketplace", kind: ResourceKind.FUNCTION, key: "marketplaceHealthJob", access: AccessIntent.INVOKE } ] },
            ] },
        ],
    },

    tags: { domain: "core", tier: "service" },
};

export default manifest;
// eof
