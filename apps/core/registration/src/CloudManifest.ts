//
// registration — CloudManifest: the service's AWS footprint (resource manifest, no CDK/AWS coupling).
//
// The A2P registration/compliance plane (TCR / 10DLC first — registration-8.1). DynamoDB holds the
// PROJECTION of TCR's state (registration-5.1 — TCR is the source of truth, we reconcile), SQS carries the
// verified webhook intake + the submit/vetting work, EventBridge ticks the reconciliation sweep, and Kafka
// publishes brand/campaign/number status + trust-score → MPS to texting/dispatch (registration-7.x).
//
// TWO ECS Fargate roles: MAIN (the /registration/* API + the registration-11.x lifecycle ops) and WEBHOOK
// (provider-facing callback intake — signature-verified, ACK-fast → enqueue; scales apart, registration-12.3).
// Both share ONE `owns.api` entry — the same shape media uses for its three roles; the gateway's resource
// routes are generated from the RestfulEndpoint defs in cloud/src/app.ts and routed by PATH, not by role.
//
import {
    ResourceManifest,
    ApiAuthorizer, LaunchType,
    AttrType,
    Ports,
    JobRuntime, ResourceKind, AccessIntent,
} from "@repo/cloud-manifest";
import { Providers } from "@repo/system";

export const manifest : ResourceManifest =
{
    service     : "registration",
    description : "A2P messaging registration + compliance — TCR/10DLC brand and campaign registration, carrier number association, and the reconciled status projection that gates texting and paces dispatch.",
    tracing     : true,

    owns:
    {
        services:
        [
            {
                // MAIN role — the /registration/* API (brand/campaign CRUD + submit, the registration-11.x
                // lifecycle ops, status reads, config). Also drains the submit/webhook/vetting queues locally.
                key             : "main",
                launchType      : LaunchType.FARGATE,
                containerPort   : Ports.REGISTRATION.MAIN,
                healthCheckPath : "/health",
                environment     : { SERVICE_ROLE: "main", LOG_LEVEL: "info" },
                sizing          : { default: { cpu: 1, memory: 2 }, production: { cpu: 2, memory: 4 } },
                autoscaling     : { default: { min: 1, max: 2, start: 1, targetCpuPercent: 60 },
                                    production: { min: 2, max: 6, start: 2, targetCpuPercent: 60 } },
                loadBalancer    : { public: false },
            },
            {
                // WEBHOOK role — TCR / Campaign-Verify callback intake only (registration-12.3). Provider
                // traffic is bursty and independent of account API traffic, so it gets its own service and
                // its own autoscaling curve; it does nothing but verify + enqueue.
                key             : "webhook",
                launchType      : LaunchType.FARGATE,
                containerPort   : Ports.REGISTRATION.WEBHOOK,
                healthCheckPath : "/health",
                environment     : { SERVICE_ROLE: "webhook", LOG_LEVEL: "info" },
                sizing          : { default: { cpu: 1, memory: 2 }, production: { cpu: 1, memory: 2 } },
                autoscaling     : { default: { min: 1, max: 2, start: 1, targetCpuPercent: 60 },
                                    production: { min: 2, max: 8, start: 2, targetCpuPercent: 60 } },
                loadBalancer    : { public: false },
            },
        ],

        // API gateway (the front door). The service enforces auth itself → authorizer NONE. /health + /version
        // are inherited; resource routes are generated from the RestfulEndpoint defs in cloud/src/app.ts.
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

        // Runtime config (AppConfig) — the CSP identity, the carrier-provider registry, the use-case/vetting
        // fee tables behind the cost-estimate stub, the per-campaign line cap, and the poll-sweep cadence.
        appConfig:
        [
            { key: "config", application: "registration", profiles: [ { key: "settings" } ] },
        ],

        // TCR CSP credentials, the Campaign Verify bridge, and one credential per carrier (CNP) — declared
        // once in @repo/system's Providers catalog so CDK, the Console, and the runtime can't drift.
        secrets: Providers.forService( "registration" ).map( ( provider ) => ( { key: provider.secretKey, description: `${ provider.label } (${ provider.category })` } ) ),

        // DynamoDB — the registration PROJECTION (registration-10.1). Account-scoped partitions keep tenant
        // isolation structural (registration-9.1); `byBrand` is the cross-account GSI the campaign list +
        // vetting-status rollup use to reach a brand's campaigns without a scan.
        //
        // `byTcrId` is the OTHER cross-account GSI, and it is load-bearing: an inbound TCR/CV callback
        // identifies the entity by TCR'S OWN id and carries no accountId, so without it every single webhook
        // would need a full-table scan to find its row (registration-5.2's hot path). It maps
        // `tcrBrandId`/`tcrCampaignId` back to the owning partition in one query.
        tables:
        [
            { key: "registration_brand",    partitionKey: { name: "accountId", type: AttrType.STRING }, sortKey: { name: "brandId", type: AttrType.STRING },
              globalSecondaryIndexes: [
                  { name: "byTcrId", partitionKey: { name: "tcrBrandId", type: AttrType.STRING }, projection: "ALL" },
              ] },
            { key: "registration_campaign", partitionKey: { name: "accountId", type: AttrType.STRING }, sortKey: { name: "campaignId", type: AttrType.STRING },
              globalSecondaryIndexes: [
                  { name: "byBrand", partitionKey: { name: "brandId", type: AttrType.STRING }, sortKey: { name: "campaignId", type: AttrType.STRING }, projection: "ALL" },
                  { name: "byTcrId", partitionKey: { name: "tcrCampaignId", type: AttrType.STRING }, projection: "ALL" },
              ] },
            // the cost-estimate LEDGER (a stub — no billing engine exists yet; see Registration.CostEstimate)
            { key: "registration_costestimate", partitionKey: { name: "accountId", type: AttrType.STRING }, sortKey: { name: "id", type: AttrType.STRING } },
        ],

        // SQS (+ DLQ) — two verified-webhook intake queues (one per provider stream, so a TCR outage can't
        // head-of-line-block Campaign Verify), the submit/resubmit/reprovision work queue, and the vetting
        // refresh queue. Visibility timeouts cover one external TCR/CSP round-trip with headroom.
        queues:
        [
            { key: "registration-webhook-tcr", maxReceiveCount: 3, dlq: true, visibilityTimeoutSec: 60 },
            { key: "registration-webhook-cv",  maxReceiveCount: 3, dlq: true, visibilityTimeoutSec: 60 },
            { key: "registration-submit",      maxReceiveCount: 5, dlq: true, visibilityTimeoutSec: 120 },
            { key: "registration-vetting",     maxReceiveCount: 5, dlq: true, visibilityTimeoutSec: 120 },
        ],

        // Lambda workers (registration-12.4). No vpc:true — each only talks to its own DynamoDB/SQS and the
        // TCR/CV/carrier APIs over the public internet, never a VPC-internal ALB.
        jobs:
        [
            { key: "registrationSubmitJob", handler: "jobs/RegistrationSubmitJob.handler", runtime: JobRuntime.NODE_22,
              memoryMB: { default: 256 }, timeoutSec: 60,
              triggers: [ { source: "queue", ref: { service: "registration", kind: ResourceKind.QUEUE, key: "registration-submit", access: AccessIntent.CONSUME }, batchSize: 5 } ] },

            // ONE webhook worker fed by BOTH intake queues — `triggers` is an Array<JobTrigger>, so a single
            // Lambda can own both event sources; the handler dispatches on the record's source queue ARN.
            { key: "registrationWebhookJob", handler: "jobs/RegistrationWebhookJob.handler", runtime: JobRuntime.NODE_22,
              memoryMB: { default: 256 }, timeoutSec: 60,
              triggers: [
                  { source: "queue", ref: { service: "registration", kind: ResourceKind.QUEUE, key: "registration-webhook-tcr", access: AccessIntent.CONSUME }, batchSize: 10 },
                  { source: "queue", ref: { service: "registration", kind: ResourceKind.QUEUE, key: "registration-webhook-cv",  access: AccessIntent.CONSUME }, batchSize: 10 },
              ] },

            { key: "registrationVettingJob", handler: "jobs/RegistrationVettingJob.handler", runtime: JobRuntime.NODE_22,
              memoryMB: { default: 256 }, timeoutSec: 120,
              triggers: [ { source: "queue", ref: { service: "registration", kind: ResourceKind.QUEUE, key: "registration-vetting", access: AccessIntent.CONSUME }, batchSize: 5 } ] },

            // EventBridge-driven only (no SQS trigger) — the reconciliation sweep.
            { key: "registrationPollJob", handler: "jobs/RegistrationPollJob.handler", runtime: JobRuntime.NODE_22,
              memoryMB: { default: 512 }, timeoutSec: 300 },
        ],

        // EventBridge — the OUTER tick for the reconciliation sweep (registration-5.3). The 5-minute cadence
        // is deliberately dumb: the job itself does the in-flight-only filter, the per-row `nextPollAt`
        // backoff, and the stop-on-terminal decision. Must come after `jobs` so the function already exists
        // when the rule is built (see ServiceStack's fixed processing order).
        eventBuses:
        [
            { key: "registration-poll", rules: [
                { key: "sweep", description: "Reconcile in-flight brands/campaigns against TCR", schedule: "rate(5 minutes)",
                  targets: [ { service: "registration", kind: ResourceKind.FUNCTION, key: "registrationPollJob", access: AccessIntent.INVOKE } ] },
            ] },
        ],
    },

    tags: { domain: "core", tier: "service" },
};

export default manifest;
// eof
