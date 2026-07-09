//
// campaign — CloudManifest: the service's AWS footprint (resource manifest, no CDK/AWS coupling).
//
// The orchestration plane: DynamoDB is the source of truth (campaigns + their channels→strategies→plans),
// the /campaign/* API is one ECS role (MAIN). Run execution (materialize audience → hand sends to the
// channels via dispatch), scheduling, and status ingestion run as Jobs (SQS / EventBridge / Kafka) — later
// additions. This is the INITIAL footprint (campaigns table + the CRUD API).
//
import {
    ResourceManifest,
    ApiAuthorizer, LaunchType,
    AttrType,
    Ports,
} from "@repo/cloud-manifest";

export const manifest : ResourceManifest =
{
    service     : "campaign",
    description : "Account campaign orchestration — the state machine that turns intent into a governed, scheduled send across channels (each channel has a strategy + schedule-based plans). Composes contact + the channels; never sends directly.",
    tracing     : true,

    owns:
    {
        // The ECS Fargate role — the /campaign/* API (root Dockerfile, APP_NAME=campaign; SERVICE_ROLE=main;
        // PORT = its slot in the CAMPAIGN block, @repo/cloud-manifest Ports: main 8150).
        services:
        [
            {
                key             : "main",
                launchType      : LaunchType.FARGATE,
                containerPort   : Ports.CAMPAIGN.MAIN,
                healthCheckPath : "/health",
                environment     : { SERVICE_ROLE: "main" },
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

        // Runtime config (AppConfig) — the campaign service's non-secret operational policy + feature flags
        // (default approvals count, A/B guardrails, …), tunable without a redeploy.
        appConfig:
        [
            { key: "config", application: "campaign", profiles: [ { key: "settings" }, { key: "flags", type: "feature_flags" } ] },
        ],

        // DynamoDB — the SoT. campaigns: PK accountId, SK campaignId; GSI status for status/ops listing.
        // (Runs, approvals, and the audience snapshot get their own tables as those subsystems land.)
        tables:
        [
            { key: "campaigns", partitionKey: { name: "accountId", type: AttrType.STRING }, sortKey: { name: "campaignId", type: AttrType.STRING },
              globalSecondaryIndexes: [
                  { name: "status", partitionKey: { name: "accountId", type: AttrType.STRING }, sortKey: { name: "status", type: AttrType.STRING }, projection: "ALL" },
              ] },
        ],
    },

    tags: { domain: "core", tier: "service" },
};

export default manifest;
// eof
