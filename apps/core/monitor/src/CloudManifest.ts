//
// monitor — CloudManifest: the service's AWS footprint (resource manifest, no CDK/AWS coupling).
//
// v1 is a single ECS role (MAIN) serving the /monitor/* read + config API. Monitor owns no tables/
// queues of its own yet — it reads OTHER services' resources live by physical identifier (see
// packages/services/src/aws CloudWatch/Ecs facades + Dynamo.describeTable/Sqs.attributesByUrl),
// per the widgets configured in MonitorConfig (its one AppConfig profile). The full observability
// pipeline (Metric Streams/Firehose/OpenSearch, X-Ray, EventBridge topology, job-run ledger,
// alarms) is SPECS.md's later phase — not built here.
//
import { ResourceManifest, ApiAuthorizer, LaunchType, Ports } from "@repo/cloud-manifest";

export const manifest : ResourceManifest =
{
    service     : "monitor",
    description : "Operational observability dashboard — a configurable widget view over DynamoDB tables, SQS queues, ECS services, Lambda jobs, and API call metrics.",
    tracing     : true,

    owns:
    {
        // The ECS Fargate role — the /monitor/* API (root Dockerfile, APP_NAME=monitor; SERVICE_ROLE=main;
        // PORT = its slot in the MONITOR block, @repo/cloud-manifest Ports: main 8280).
        services:
        [
            {
                key             : "main",
                launchType      : LaunchType.FARGATE,
                containerPort   : Ports.MONITOR.MAIN,
                healthCheckPath : "/health",
                environment     : { SERVICE_ROLE: "main", LOG_LEVEL: "info" },
                sizing          : { default: { cpu: 1, memory: 2 }, production: { cpu: 1, memory: 2 } },
                autoscaling     : { default: { min: 1, max: 2, start: 1, targetCpuPercent: 60 },
                                    production: { min: 1, max: 2, start: 1, targetCpuPercent: 60 } },
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
            throttle   : { default: { rateLimit: 50, burstLimit: 100 },
                           production: { rateLimit: 200, burstLimit: 400 } },
            endpoints  :
            [
                { method: "GET", path: "/version", public: true, authRequired: false },
                { method: "GET", path: "/health",  public: true, authRequired: false },
            ],
        },

        // Runtime config (AppConfig) — the configured dashboard widget list (MonitorConfig), tunable
        // without a redeploy.
        appConfig:
        [
            { key: "config", application: "monitor", profiles: [ { key: "settings" } ] },
        ],
    },

    tags: { domain: "core", tier: "service" },
};

export default manifest;
// eof
