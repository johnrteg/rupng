import {
    ResourceManifest,
    ApiAuthorizer, LaunchType, BucketAccess,
    AttrType,
    Ports,
    ResourceKind, AccessIntent,
} from "@repo/cloud-manifest";
import { Providers } from "@repo/system";

export const manifest : ResourceManifest =
{
    service     : "voice",
    description : "Account voice channel — automated outbound calls (prerecorded/TTS), a minimal single-step IVR (say/play + opt-out), and call-log/outcomes over pluggable providers. Scaffold + fake/Twilio providers; see apps/core/voice/SPECS.md for the full (not-yet-built) IVR flow engine, AMD, and STIR/SHAKEN surface.",
    tracing     : true,

    owns:
    {
        services:
        [
            {
                key             : "main",
                launchType      : LaunchType.FARGATE,
                containerPort   : Ports.VOICE.MAIN,
                healthCheckPath : "/health",
                environment     : { SERVICE_ROLE: "main", LOG_LEVEL: "trace" },
                sizing          : { default: { cpu: 1, memory: 2 }, production: { cpu: 2, memory: 4 } },
                autoscaling     : { default: { min: 1, max: 2, start: 1, targetCpuPercent: 60 },
                                    production: { min: 2, max: 6, start: 2, targetCpuPercent: 60 } },
                loadBalancer    : { public: false },
            },
        ],

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

        appConfig:
        [
            // "ai" — the AiRouting (TEXT_TO_SPEECH) profile every service running @repo/ai's AiFactory reads
            // (Application.aiFor/aiRouting), same as media's own manifest.
            { key: "config", application: "voice", profiles: [ { key: "settings" }, { key: "ai" }, { key: "flags", type: "feature_flags" } ] },
        ],

        secrets: Providers.forService( "voice" ).map( ( provider ) => ( { key: provider.secretKey, description: `${ provider.label } (${ provider.category })` } ) ),

        buckets:
        [
            // "tts/" — synthesized TTS audio, content-hash-keyed cache; regenerable, so a short expiry just
            // bounds storage growth. "recordings/" — call recordings, PII: expiry here is the enforcement
            // mechanism for voice-9.1's retention requirement (no per-row TTL job needed — DynamoDB can't
            // expire a single attribute, only a whole item, so the retention lives at the bucket level and
            // `/voice/internal/erase` purges ahead of it on request). Both served via short-lived presigned
            // GET URLs — not a durable asset library (that's `media`'s job; a future migration, see
            // apps/core/voice/SPECS.md gaps).
            { key: "voice", access: BucketAccess.PRIVATE, encryption: true,
              lifecycle: [ { prefix: "tts/", expireDays: 30 }, { prefix: "recordings/", expireDays: 90 } ] },
        ],

        tables:
        [
            { key: "voice_calls",       partitionKey: { name: "accountId", type: AttrType.STRING }, sortKey: { name: "callId", type: AttrType.STRING } },
            { key: "voice_suppression", partitionKey: { name: "accountId", type: AttrType.STRING }, sortKey: { name: "to", type: AttrType.STRING } },
            { key: "voice_numbers",     partitionKey: { name: "accountId", type: AttrType.STRING }, sortKey: { name: "callerId", type: AttrType.STRING } },
            { key: "voice_flows",       partitionKey: { name: "accountId", type: AttrType.STRING }, sortKey: { name: "flowId", type: AttrType.STRING } },

            // `WorkQueue` governor tables (packages/services/src/WorkQueue.ts) — voice's adoption, for
            // abandoned-call / concurrency+connect-rate pacing (SPECS.md gap #8). Shape is the governor's
            // own fixed contract, documented in its file header — not voice-specific.
            { key: "wq_jobs", partitionKey: { name: "queue", type: AttrType.STRING }, sortKey: { name: "jobId", type: AttrType.STRING },
              globalSecondaryIndexes: [
                  { name: "gsi_status_account", partitionKey: { name: "statusAccountPk", type: AttrType.STRING }, sortKey: { name: "createdAt", type: AttrType.STRING }, projection: "ALL" },
              ] },
            { key: "wq_queue_config",         partitionKey: { name: "queue", type: AttrType.STRING } },
            { key: "wq_account_config",       partitionKey: { name: "accountId", type: AttrType.STRING } },
            { key: "wq_account_queue_config", partitionKey: { name: "accountId", type: AttrType.STRING }, sortKey: { name: "queue", type: AttrType.STRING } },
        ],

        // ElastiCache Serverless (Redis) — the `WorkQueue` governor's ACTIVITY store (fairness ZSET, token
        // buckets, per-minute bins); resolved via the default logical key `"cache"` (`new Cache(cloud)`).
        caches:
        [
            { key: "cache", description: "WorkQueue governor activity store (fairness/rate-limit metrics)" },
        ],

        queues:
        [
            { key: "voice-send",      maxReceiveCount: 3, dlq: true, visibilityTimeoutSec: 120 },
            { key: "voice-status",    maxReceiveCount: 3, dlq: true, visibilityTimeoutSec: 60 },
            // downloading + (optionally) transcribing a recording can run past a request's budget — its own
            // queue + a longer visibility timeout, same shape as the other two.
            { key: "voice-recording", maxReceiveCount: 3, dlq: true, visibilityTimeoutSec: 180 },
        ],
    },

    // S2S: register a synthesized TTS clip in media's asset library (best-effort — see MediaClient) so it's
    // cross-service reusable + operator-visible, same pattern as social → marketplace.
    uses:
    [
        { service: "media", kind: ResourceKind.SERVICE, key: "main", access: AccessIntent.INVOKE },
    ],

    tags: { domain: "core", tier: "service" },
};

export default manifest;
// eof
