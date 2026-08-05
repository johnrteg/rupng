//
// contact — CloudManifest: the service's AWS footprint (resource manifest, no CDK/AWS coupling).
//
// The light-CRM plane: DynamoDB is the source of truth (contacts + segments), the /contact/* API is one
// ECS role (MAIN). Segmentation/search runs against the search service (fed by contact.* events) and GDPR
// forget fans out via a queue — both are later additions; this is the INITIAL footprint (contacts + segments).
//
import {
    ResourceManifest,
    ApiAuthorizer, LaunchType,
    AttrType,
    Ports,
} from "@repo/cloud-manifest";

export const manifest : ResourceManifest =
{
    service     : "contact",
    description : "Account contact plane — the light-CRM: contacts + PII, tags, per-channel consent/suppression, and segments (the primary targeting tool).",
    tracing     : true,

    owns:
    {
        // The ECS Fargate role — the /contact/* API (root Dockerfile, APP_NAME=contact; SERVICE_ROLE=main;
        // PORT = its slot in the CONTACT block, @repo/cloud-manifest Ports: main 8140).
        services:
        [
            {
                key             : "main",
                launchType      : LaunchType.FARGATE,
                containerPort   : Ports.CONTACT.MAIN,
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

        // Runtime config (AppConfig) — the contact service's non-secret operational policy + feature flags,
        // tunable without a redeploy.
        appConfig:
        [
            { key: "config", application: "contact", profiles: [ { key: "settings" }, { key: "flags", type: "feature_flags" } ] },
        ],

        // DynamoDB — the SoT. contacts: PK accountId, SK contactId; GSI status for status/ops listing.
        // segments: PK accountId, SK segmentId. (External-id GSI + import/export tables are later additions.)
        tables:
        [
            { key: "contacts", partitionKey: { name: "accountId", type: AttrType.STRING }, sortKey: { name: "contactId", type: AttrType.STRING },
              globalSecondaryIndexes: [
                  { name: "status", partitionKey: { name: "accountId", type: AttrType.STRING }, sortKey: { name: "status", type: AttrType.STRING }, projection: "ALL" },
              ] },
            { key: "segments", partitionKey: { name: "accountId", type: AttrType.STRING }, sortKey: { name: "segmentId", type: AttrType.STRING } },
            // per-account monotonic sequence counters (one item per (accountId, kind: contact | segment), attr `n`)
            // — the source of the human-facing `ref` numbers for contacts + segments. Atomic ADD; independent of
            // the entity tables so a purged contact/segment never frees its number for reuse. PK accountId, SK kind.
            { key: "contact_counters", partitionKey: { name: "accountId", type: AttrType.STRING }, sortKey: { name: "kind", type: AttrType.STRING } },
            // custom-field DEFINITIONS (account-level schema; managed under Settings → Contacts). Values live
            // on the contact row keyed by fieldUid. PK accountId, SK fieldUid.
            { key: "field_defs", partitionKey: { name: "accountId", type: AttrType.STRING }, sortKey: { name: "fieldUid", type: AttrType.STRING } },
            // segment ↔ contact membership JOIN (many-to-many). PK segmentKey (`accountId#segmentId`) → list a
            // segment's contacts; GSI byContact (contactKey `accountId#contactId`) → list a contact's segments.
            // Both directions are single Queries (no scans, no 400KB item ceiling).
            { key: "segment_members", partitionKey: { name: "segmentKey", type: AttrType.STRING }, sortKey: { name: "contactId", type: AttrType.STRING },
              globalSecondaryIndexes: [
                  { name: "byContact", partitionKey: { name: "contactKey", type: AttrType.STRING }, sortKey: { name: "segmentId", type: AttrType.STRING }, projection: "ALL" },
              ] },
            // segment materialization run history — one record per (re)materialize (when/who/added/removed/total).
            // PK segmentKey (`accountId#segmentId`), SK at (ISO — newest via reverse scan).
            { key: "segment_runs", partitionKey: { name: "segmentKey", type: AttrType.STRING }, sortKey: { name: "at", type: AttrType.STRING } },
            // reusable CSV/import column→field maps. PK accountId, SK mapId. Platform-provided (system) maps
            // live under a reserved `accountId = "system"` partition so an account reads system + its own maps
            // in one Query; account maps are the account's own (create/edit/copy/archive/delete).
            { key: "import_maps", partitionKey: { name: "accountId", type: AttrType.STRING }, sortKey: { name: "mapId", type: AttrType.STRING } },
        ],

        // Work queues — recompute the per-channel reachability counts of the segments a contact belongs to,
        // off the request path, whenever the contact's channels/consent change (a contact can be in many
        // segments). MAIN drains it locally; a Job Lambda in a deploy.
        queues:
        [
            { key: "contact-segment-refresh", maxReceiveCount: 3, dlq: true, visibilityTimeoutSec: 120 },
            // (re)materialize a segment's QUERY membership from its saved filter — evaluate → reconcile join
            // rows → recount → flip PENDING→ACTIVE. Off the request path (can scan the contacts partition).
            { key: "contact-segment-materialize", maxReceiveCount: 3, dlq: true, visibilityTimeoutSec: 300 },
        ],
    },

    tags: { domain: "core", tier: "service" },
};

export default manifest;
// eof
