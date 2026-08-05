//
// media — CloudManifest: the service's AWS footprint (resource manifest, no CDK/AWS coupling).
//
// The media plane: S3 holds bytes, DynamoDB holds the truth (the object index), SQS drives the ingest
// pipeline (scan → process), CloudFront (added later) serves public bytes. One ECS role (Main = the /media/*
// API). Processing runs as Jobs (MediaScanJob / MediaProcessJob) off the queues; locally the Main service
// also drains them so the pipeline works end-to-end without a separate job runtime.
//
import {
    ResourceManifest,
    ApiAuthorizer, LaunchType, BucketAccess,
    AttrType,
    ManagedAiService,
    Ports,
    AccessIntent, ResourceKind, JobRuntime,
} from "@repo/cloud-manifest";
import { Providers } from "@repo/system";

export const manifest : ResourceManifest =
{
    service     : "media",
    description : "Account media plane — storage (S3), object index (DynamoDB), ingest pipeline (SQS scan → process), delivery. Focus: images.",
    tracing     : true,

    // Managed AWS AI services the media compute calls over IAM (no key): Bedrock (AI generate — image/video),
    // Transcribe (speech-to-text; stages audio through the media-staging bucket). Grants a curated action set
    // to the task role + job Lambdas (see ServiceStack.AI_SERVICE_ACTIONS).
    aiServices  : [ ManagedAiService.BEDROCK, ManagedAiService.TRANSCRIBE ],

    owns:
    {
        // The ECS Fargate role — the /media/* API (root Dockerfile, APP_NAME=media; SERVICE_ROLE=main;
        // PORT = its slot in the MEDIA block, @repo/services Ports: main 8240).
        services:
        [
            {
                key             : "main",
                launchType      : LaunchType.FARGATE,
                containerPort   : Ports.MEDIA.MAIN,
                healthCheckPath : "/health",
                environment     : { SERVICE_ROLE: "main" },
                sizing          : { default: { cpu: 1, memory: 2 }, production: { cpu: 2, memory: 4 } },
                autoscaling     : { default: { min: 1, max: 2, start: 1, targetCpuPercent: 60 },
                                    production: { min: 2, max: 6, start: 2, targetCpuPercent: 60 } },
                loadBalancer    : { public: false },
            },
            {
                // BROWSE role — the /media/browse/* asset marketplace (provider fan-out). Separate service so
                // it scales independently of the media API; shares the media plane (S3 + DDB + import pipeline).
                key             : "browse",
                launchType      : LaunchType.FARGATE,
                containerPort   : Ports.MEDIA.BROWSE,
                healthCheckPath : "/health",
                environment     : { SERVICE_ROLE: "browse" },
                sizing          : { default: { cpu: 1, memory: 2 }, production: { cpu: 2, memory: 4 } },
                autoscaling     : { default: { min: 1, max: 2, start: 1, targetCpuPercent: 60 },
                                    production: { min: 2, max: 6, start: 2, targetCpuPercent: 60 } },
                loadBalancer    : { public: false },
            },
            {
                // STUDIO role — the /media/studio/* creation & editing surface (media-21, stub). Its own service
                // so it scales independently of the API; shares the media plane (S3 + DDB + pipeline + AI).
                key             : "studio",
                launchType      : LaunchType.FARGATE,
                containerPort   : Ports.MEDIA.STUDIO,
                healthCheckPath : "/health",
                environment     : { SERVICE_ROLE: "studio" },
                sizing          : { default: { cpu: 1, memory: 2 }, production: { cpu: 2, memory: 4 } },
                autoscaling     : { default: { min: 1, max: 2, start: 1, targetCpuPercent: 60 },
                                    production: { min: 2, max: 4, start: 1, targetCpuPercent: 60 } },
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

        // Runtime config (AppConfig) — the media service's non-secret operational policy (MediaConfig: upload
        // limits, variant profiles, delivery TTLs, lifecycle windows, the scan switch), tunable without a
        // redeploy. Seeded on boot with MediaConfig.DEFAULT.
        appConfig:
        [
            { key: "config", application: "media", profiles: [ { key: "settings" }, { key: "browse" }, { key: "ai" }, { key: "flags", type: "feature_flags" } ] },
        ],

        // Secrets — Browse provider API keys (media-16.1), root-managed in Secrets Manager (never AppConfig/env).
        // Created empty on deploy; the value is set by a root op (root API / `awslocal secretsmanager
        // put-secret-value`). The service reads them via `Secrets.get("browse-<provider>")`.
        // DERIVED from the provider registry (@repo/system Providers) — every provider this service OWNS
        // (Browse: Pexels/Unsplash). The service reads them via `Secrets.get("<secretKey>")`.
        secrets: Providers.forService( "media" ).map( ( provider ) => ( { key: provider.secretKey, description: `${ provider.label } (${ provider.category })` } ) ),

        // S3 — the per-account media bytes. PRIVATE by default (served via signed URLs / CDN, never public).
        // Versioned (media-1.3 keeps the original). Object keys are the typed S3.ObjectKey MEDIA / AVATAR
        // layouts. A CloudFront distribution + OAC for the public tier is a later addition (media-2.3).
        buckets:
        [
            {
                key       : "media",
                access    : BucketAccess.PRIVATE,
                versioned : true,
                encryption: true,
                cors      : true,               // direct-to-S3 presigned PUT from the browser
                presignedUpload: true,          // provision the presigner path (media-3.1)
                lifecycle : [ { prefix: "", transitionToInfrequentDays: 60, transitionToGlacierDays: 180 } ],   // cold tiering (media-6.1)
            },
            // AI-generation STAGING bytes (media-18) — candidate images/videos live here until the user promotes
            // one into the library (never a Media.Asset until then). SEPARATE bucket so generated candidates are
            // fully isolated from the account library. A lifecycle rule auto-expires abandoned candidates.
            {
                key       : "media-staging",
                access    : BucketAccess.PRIVATE,
                encryption: true,
                lifecycle : [ { prefix: "", expireDays: 7 } ],   // discard un-promoted candidates after 7 days
            },
        ],

        // DynamoDB — the object index (media-1.2). PK accountId, SK guid; GSI parentId to list a source's
        // variants; GSI status for quarantine/ops listing. TTL on `ttl` for expiry (media-1.4).
        tables:
        [
            { key: "media", partitionKey: { name: "accountId", type: AttrType.STRING }, sortKey: { name: "guid", type: AttrType.STRING },
              ttlAttribute: "ttl",
              globalSecondaryIndexes: [
                  { name: "parentUid", partitionKey: { name: "parentUid", type: AttrType.STRING }, projection: "ALL" },
                  { name: "status",    partitionKey: { name: "accountId", type: AttrType.STRING }, sortKey: { name: "status", type: AttrType.STRING }, projection: "ALL" },
              ] },
            // Download archives (media-20) — the "Downloads" view: zip jobs + their S3 objects, SEPARATE from
            // the asset index so they never appear in the library. TTL on `ttl` sweeps expired zips.
            { key: "archives", partitionKey: { name: "accountId", type: AttrType.STRING }, sortKey: { name: "archiveId", type: AttrType.STRING },
              ttlAttribute: "ttl" },
            // Cloned voices (media-21) — account-scoped synthetic voices (speech-cloning is account-only); their
            // own table so a voice is never visible/usable across accounts.
            { key: "voices", partitionKey: { name: "accountId", type: AttrType.STRING }, sortKey: { name: "voiceId", type: AttrType.STRING } },
            // AI-generation staging batches (media-18) — one row per generate request; holds the candidates +
            // their per-candidate status/bytes-key while they're staged (NOT in the library). TTL sweeps
            // abandoned batches (matches the staging bucket's lifecycle). Removed when a batch is discarded.
            { key: "media_staging", partitionKey: { name: "accountId", type: AttrType.STRING }, sortKey: { name: "batchId", type: AttrType.STRING },
              ttlAttribute: "ttl" },
            // Studio projects (media-21) — the project tree metadata (name/kind/campaign/tags/page + the saved
            // library asset guid). The tldraw canvas snapshot lives in S3 (the media bucket), keyed by project.
            { key: "studio_projects", partitionKey: { name: "accountId", type: AttrType.STRING }, sortKey: { name: "id", type: AttrType.STRING } },
            // SVG editor templates (SVG_EDITOR_SPEC §16) — the template library, SEPARATE from projects. PK
            // `owner` (the reserved "__system__" partition for platform templates, else the owning accountId)
            // + SK `id`, so a query returns one scope's templates tenant-safely. The doc JSON lives in S3.
            { key: "svg-templates", partitionKey: { name: "owner", type: AttrType.STRING }, sortKey: { name: "id", type: AttrType.STRING } },
            // SVG library graphics (icons/logos/clipart) — SEPARATE from svg-templates (whole documents) and
            // from the general `media` table (raster/video pipeline doesn't apply to vector markup). Same
            // owner-partition shape: PK `owner` (the reserved "__system__" partition for platform-wide, read-
            // only graphics, else the owning accountId) + SK `id`. The markup itself lives in S3 (sanitized).
            { key: "svg-assets", partitionKey: { name: "owner", type: AttrType.STRING }, sortKey: { name: "id", type: AttrType.STRING } },
            // SVG upload quarantine (SvgThreatScanner) — raw markup rejected for carrying a genuine attack
            // vector (script/event-handler/external-reference/external-stylesheet), kept for a review window
            // rather than silently sanitized-and-stored. SEPARATE from svg-assets so a quarantined upload never
            // appears in the library. TTL on `ttl` expires the row; no active sweep (matches this repo's other
            // TTL tables — DynamoDB's native TTL deletion is the whole mechanism).
            { key: "svg-asset-quarantine", partitionKey: { name: "owner", type: AttrType.STRING }, sortKey: { name: "id", type: AttrType.STRING },
              ttlAttribute: "ttl" },
            // SVG editor export-render jobs (SVG_EDITOR_SPEC §10) — async job status polled by the client. PK
            // `pk` = jobId; the row carries status + the presigned outputUrl (once DONE) / error.
            { key: "svg-render-jobs", partitionKey: { name: "pk", type: AttrType.STRING } },
        ],

        // Work queues (auto-DLQ) — the ingest pipeline. On upload-complete (or an S3-created event) the item
        // fans: media-scan (malware scan — stubbed no-op for now, media-5.1) → on clean → media-process
        // (image variants via Sharp). Both consumed by the Jobs; the Main service also drains them locally.
        queues:
        [
            { key: "media-scan",       maxReceiveCount: 5, dlq: true, visibilityTimeoutSec: 120 },
            { key: "media-process",    maxReceiveCount: 5, dlq: true, visibilityTimeoutSec: 300 },
            // media-19.1 — one queue per heavy async operation (Jobs; MAIN drains locally). Each emits Kafka
            // media.job stage events for UI progress + workflows (media-19.2).
            { key: "media-generate",   maxReceiveCount: 3, dlq: true, visibilityTimeoutSec: 600 },   // AI generation (image/video/voice/sound)
            { key: "media-transcribe", maxReceiveCount: 3, dlq: true, visibilityTimeoutSec: 600 },   // audio extract + speech-to-text
            { key: "media-archive",    maxReceiveCount: 3, dlq: true, visibilityTimeoutSec: 300 },   // zip original + variants for download
            { key: "media-video",      maxReceiveCount: 2, dlq: true, visibilityTimeoutSec: 900 },   // video compression (ffmpeg CRF ladder, media-10.10)
            { key: "studio-render",    maxReceiveCount: 2, dlq: true, visibilityTimeoutSec: 900 },   // Studio video render — ffmpeg composite of the timeline → mp4 (media-21)
            { key: "studio-render-remotion", maxReceiveCount: 2, dlq: true, visibilityTimeoutSec: 1800 },   // Studio video render — Remotion/Chromium exact-fidelity render (media-21.18); longer timeout (heavier)
            // SVG editor export render (SVG_EDITOR_SPEC §10) — compile SvgDocument → SVG → PNG/PDF/JPEG via
            // Puppeteer; a consumer flips the svg-render-jobs row to DONE/FAILED. A render normally finishes in
            // seconds, so the timeout stays short — if a consumer dies mid-render (a crash, or a dev-mode
            // restart) the message becomes visible again quickly instead of leaving the job's row stuck at
            // PENDING for a long, silent stretch.
            { key: "svg-render",       maxReceiveCount: 2, dlq: true, visibilityTimeoutSec: 120 },
        ],

        // The Lambda worker for SVG export-render (SVG_EDITOR_SPEC §10) — decouples Puppeteer/Chromium's CPU
        // + memory footprint from the MAIN role's API traffic and scales with queue depth. MAIN's own consumer
        // (a full-`puppeteer` in-process poll loop) still drains this queue for local/LocalStack dev, matching
        // this repo's "MAIN drains locally, Job owns it in a real deploy" convention for the other queues.
        // Higher memory than the app service's jobs (256MB default) — Chromium needs real headroom.
        jobs:
        [
            {
                key        : "svgRender",
                handler    : "jobs/SvgRenderJob.handler",
                runtime    : JobRuntime.NODE_22,
                memoryMB   : { default: 2048 },
                timeoutSec : 300,
                triggers   : [ { source: "queue", ref: { service: "media", kind: ResourceKind.QUEUE, key: "svg-render", access: AccessIntent.CONSUME }, batchSize: 1 } ],
            },
        ],
    },

    tags: { domain: "core", tier: "service" },
};

export default manifest;
// eof
