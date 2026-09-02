//
// workflow — CloudManifest: the service's AWS footprint (resource manifest, no CDK/AWS coupling).
//
// The orchestration brain of automation (see README.md + SPECS.md). Two ECS roles — `main` (the
// /workflow/* authoring + instance API) and `trigger` (a long-running Kafka Consumer, no containerPort/
// loadBalancer, same shape as search's `indexer` — matching every trigger event against account
// definitions and starting/signaling instances). DynamoDB holds definitions (+ versions) and instances.
// Two SQS queues drive the step-execution loop: `workflow-advance` (normal step execution — every
// decide→dispatch→persist tick) and `workflow-scheduler-wake` (the delivery target for EventBridge
// Scheduler `sleep`/timeout wakeups — see `owns.scheduler` + `WorkflowSchedulerJob`).
//
// SCOPE (this pass) — the definition/instance CRUD + versioning API, and an execution-engine SLICE
// (start/end/if/send_text/sleep/wait_for_response only; `send_text`'s delegation to texting/dispatch is
// stubbed, not real — see WorkflowStepJob.ts). The other ~25 node types, real cross-service delegation,
// simulation, metrics, and the kill-switch are deferred (see SPECS.md's own priority register).
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
    service     : "workflow",
    description : "The account-defined automation engine — a durable, branching, per-subject journey the platform runs across restarts and long waits. Owns definitions/triggers/instances/control-flow; delegates every side effect to the owning service.",
    tracing     : true,

    owns:
    {
        // Two Fargate roles: `main` (the HTTP authoring/instance API) + `trigger` (the Kafka Consumer —
        // no containerPort/loadBalancer, it pulls its own work off the event stream, same shape as
        // search's `indexer` role).
        services:
        [
            {
                key             : "main",
                launchType      : LaunchType.FARGATE,
                containerPort   : Ports.WORKFLOW.MAIN,
                healthCheckPath : "/health",
                environment     : { SERVICE_ROLE: "main", LOG_LEVEL: "info" },
                sizing          : { default: { cpu: 1, memory: 2 }, production: { cpu: 2, memory: 4 } },
                autoscaling     : { default: { min: 1, max: 2, start: 1, targetCpuPercent: 60 },
                                    production: { min: 2, max: 6, start: 2, targetCpuPercent: 60 } },
                loadBalancer    : { public: false },
            },
            {
                key             : "trigger",
                launchType      : LaunchType.FARGATE,
                environment     : { SERVICE_ROLE: "trigger", LOG_LEVEL: "info" },
                sizing          : { default: { cpu: 1, memory: 2 }, production: { cpu: 1, memory: 2 } },
                autoscaling     : { default: { min: 1, max: 1, start: 1, targetCpuPercent: 70 },
                                    production: { min: 1, max: 2, start: 1, targetCpuPercent: 70 } },
            },
        ],

        // API gateway. The service enforces auth itself -> authorizer NONE. /health + /version are
        // inherited; resource routes are appended in cloud/src/app.ts (apiEndpoints).
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

        // DynamoDB. `workflows` is the mutable HEAD row per definition (PK accountId, SK defId).
        // `workflow_versions` holds immutable published snapshots (SK "<defId>#V<n>") so a running
        // instance can always resolve the exact version it started on, even after the head evolves.
        // `workflow_instances` is the per-run store; the `byWaitKey` GSI resolves an external inbound
        // signal (e.g. a contact's SMS reply) to the parked (instance, node) awaiting it.
        tables:
        [
            { key: "workflows", partitionKey: { name: "accountId", type: AttrType.STRING }, sortKey: { name: "defId", type: AttrType.STRING } },
            { key: "workflow_versions", partitionKey: { name: "accountId", type: AttrType.STRING }, sortKey: { name: "versionSk", type: AttrType.STRING } },
            { key: "workflow_instances", partitionKey: { name: "accountId", type: AttrType.STRING }, sortKey: { name: "instanceSk", type: AttrType.STRING },
              globalSecondaryIndexes: [
                  { name: "byWaitKey", partitionKey: { name: "waitKey", type: AttrType.STRING }, projection: "ALL" },
              ] },
        ],

        // SQS (+DLQ). `workflow-advance` is the step-execution loop's queue (fed by the trigger consumer,
        // the manual-start endpoint, and a step re-enqueuing its own next tick). `workflow-scheduler-wake`
        // is the delivery target the dynamic `Scheduler` facade (below) posts a sleep/timeout wake to.
        queues:
        [
            { key: "workflow-advance",        maxReceiveCount: 5, dlq: true, visibilityTimeoutSec: 30 },
            { key: "workflow-scheduler-wake",  maxReceiveCount: 5, dlq: true, visibilityTimeoutSec: 30 },
        ],

        // Lambda workers — one per queue above (SPECS.md "Service & Job topology": WorkflowStepJob /
        // WorkflowSchedulerJob both `extends WorkflowJob`).
        jobs:
        [
            { key: "workflowStepJob", handler: "jobs/WorkflowStepJob.handler", runtime: JobRuntime.NODE_22,
              memoryMB: { default: 256 }, timeoutSec: 30,
              triggers: [ { source: "queue", ref: { service: "workflow", kind: ResourceKind.QUEUE, key: "workflow-advance", access: AccessIntent.CONSUME }, batchSize: 1 } ] },
            { key: "workflowSchedulerJob", handler: "jobs/WorkflowSchedulerJob.handler", runtime: JobRuntime.NODE_22,
              memoryMB: { default: 256 }, timeoutSec: 30,
              triggers: [ { source: "queue", ref: { service: "workflow", kind: ResourceKind.QUEUE, key: "workflow-scheduler-wake", access: AccessIntent.CONSUME }, batchSize: 1 } ] },
        ],

        // EventBridge Scheduler — the DYNAMIC per-instance schedule group `sleep`/`wait_for_response`
        // timeouts use (one schedule per waiting node, created/deleted at runtime via the `Scheduler`
        // facade; NOT a fixed deploy-time rule). Delivers to `workflow-scheduler-wake` above.
        scheduler:
        {
            group: "workflow",
        },
    },

    // Kafka — the trigger consumer's starter subscription set (README.md "Triggers" — event-initiated).
    // This is a STARTER list proving the fan-out/match loop, not the full "any Events action" surface
    // (workflow-7.1) — extend as more trigger sources are wired.
    subscribes:
    [
        { topic: Events.Object.CONTACT_CONTACT, consumerGroup: "workflow-trigger" },
    ],

    tags: { domain: "core", tier: "service" },
};

export default manifest;
// eof
