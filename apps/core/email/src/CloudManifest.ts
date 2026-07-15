//
// email — CloudManifest: the service's AWS footprint (resource manifest, no CDK/AWS coupling).
//
// The email channel: DynamoDB is the source of truth (versioned templates + the send log + the suppression
// list); S3 keeps the per-version template body history; two SQS queues carry the async work (the SEND worker
// and inbound delivery FEEDBACK — bounces/complaints). Provider API keys (SendGrid, Postmark, …) live in
// Secrets Manager, derived from the provider registry. The /email/* API is one ECS role (MAIN), which also
// drains the queues locally and consumes the transactional events that trigger system mail.
//
import {
    ResourceManifest,
    ApiAuthorizer, LaunchType, BucketAccess,
    AttrType,
    Ports,
} from "@repo/cloud-manifest";
import { Providers } from "@repo/system";

export const manifest : ResourceManifest =
{
    service     : "email",
    description : "Account email channel — versioned Studio templates, transactional + campaign sends over pluggable providers, per-account limits, and a suppression list.",
    tracing     : true,

    owns:
    {
        // The ECS Fargate role — the /email/* API (root Dockerfile, APP_NAME=email; SERVICE_ROLE=main;
        // PORT = its slot in the EMAIL block, @repo/cloud-manifest Ports: main 8190).
        services:
        [
            {
                key             : "main",
                launchType      : LaunchType.FARGATE,
                containerPort   : Ports.EMAIL.MAIN,
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

        // Runtime config (AppConfig) — the email service's non-secret operational policy (default/system
        // provider, per-account limits, provider registry) + feature flags, tunable without a redeploy.
        appConfig:
        [
            { key: "config", application: "email", profiles: [ { key: "settings" }, { key: "flags", type: "feature_flags" } ] },
        ],

        // Secrets — one slot per configured provider (SendGrid, Postmark, …), derived from the provider
        // registry so the physical name stays `<env>-<owner>-secret-email-<id>`. Values are set out-of-band.
        secrets: Providers.forService( "email" ).map( ( provider ) => ( { key: provider.secretKey, description: `${ provider.label } (${ provider.category })` } ) ),

        // S3 — the per-version template body history (JSON doc + compiled MJML/HTML), versioned like media.
        buckets:
        [
            {
                key       : "email",
                access    : BucketAccess.PRIVATE,
                versioned : true,
                encryption: true,
            },
        ],

        // DynamoDB — the SoT. templates: PK accountId ("system" for platform templates), SK templateId; GSI
        // byType (accountId, notificationType) resolves the published template for a transactional case.
        // send_log: PK accountId, SK messageId (one row per delivered message + its operational status).
        // suppression: PK accountId, SK email (unsubscribe / hard-bounce / complaint — the canSend() block list).
        tables:
        [
            { key: "email_templates", partitionKey: { name: "accountId", type: AttrType.STRING }, sortKey: { name: "templateId", type: AttrType.STRING },
              globalSecondaryIndexes: [
                  { name: "byType", partitionKey: { name: "accountId", type: AttrType.STRING }, sortKey: { name: "notificationType", type: AttrType.STRING }, projection: "ALL" },
              ] },
            { key: "email_log", partitionKey: { name: "accountId", type: AttrType.STRING }, sortKey: { name: "messageId", type: AttrType.STRING } },
            { key: "email_suppression", partitionKey: { name: "accountId", type: AttrType.STRING }, sortKey: { name: "email", type: AttrType.STRING } },
            // blasts: a tracked batch/scheduled send (suspend/resume/reschedule/cancel). PK accountId, SK blastId.
            { key: "email_blasts", partitionKey: { name: "accountId", type: AttrType.STRING }, sortKey: { name: "blastId", type: AttrType.STRING } },
        ],

        // Work queues — the SEND worker (render → gate → transport, off the request path so a slow provider
        // never blocks a 202) and inbound delivery FEEDBACK (bounce/complaint notifications → suppression +
        // status). MAIN drains both locally; Job Lambdas own them in a deploy. Both auto-provision a DLQ.
        queues:
        [
            { key: "email-send",     maxReceiveCount: 3, dlq: true, visibilityTimeoutSec: 120 },
            { key: "email-feedback", maxReceiveCount: 3, dlq: true, visibilityTimeoutSec: 60 },
            // the BATCH worker — expands a blast's audience + paces the per-recipient fan-out onto email-send.
            { key: "email-batch",    maxReceiveCount: 3, dlq: true, visibilityTimeoutSec: 300 },
        ],
    },

    tags: { domain: "core", tier: "service" },
};

export default manifest;
// eof
