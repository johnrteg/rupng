import {
    ResourceManifest,
    ApiAuthorizer, LaunchType, BucketAccess,
    AttrType,
    Ports,
    ResourceKind, AccessIntent,
} from "@repo/cloud-manifest";
import { Providers, Events } from "@repo/system";

export const manifest : ResourceManifest =
{
    service     : "print",
    description : "The physical direct-mail `send` channel — render/verify/submit/track postcards, letters, self-mailers, and checks via a mail-fulfillment provider (PostGrid/Lob), with a SEPARATE address-verification factory (USPS/PostGrid/Lob/Melissa/SmartyStreets). Scaffold + fake providers; see apps/core/print/SPECS.md for the full design.",
    tracing     : true,

    owns:
    {
        services:
        [
            {
                key             : "main",
                launchType      : LaunchType.FARGATE,
                containerPort   : Ports.PRINT.MAIN,
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
            { key: "config", application: "print", profiles: [ { key: "settings" }, { key: "flags", type: "feature_flags" } ] },
        ],

        secrets: Providers.forService( "print" ).map( ( provider ) => ( { key: provider.secretKey, description: `${ provider.label } (${ provider.category })` } ) ),

        buckets:
        [
            // rendered print-ready PDFs + proofs — mailpieces are archived, never silently dropped (print-8.2),
            // so no lifecycle expiry here (unlike voice's ephemeral TTS/recording caches).
            { key: "print", access: BucketAccess.PRIVATE, encryption: true },
        ],

        tables:
        [
            // gsi_mailid — the tracking webhook (one global endpoint per provider, not per-account) receives
            // only a mailId; this GSI resolves the owning account before a tracking event can be applied.
            { key: "print_mailpieces",  partitionKey: { name: "accountId", type: AttrType.STRING }, sortKey: { name: "mailId", type: AttrType.STRING },
              globalSecondaryIndexes: [
                  { name: "gsi_mailid", partitionKey: { name: "mailId", type: AttrType.STRING }, projection: "ALL" },
              ] },
            { key: "print_templates",   partitionKey: { name: "accountId", type: AttrType.STRING }, sortKey: { name: "id", type: AttrType.STRING } },
            { key: "print_tracking",    partitionKey: { name: "accountId", type: AttrType.STRING }, sortKey: { name: "sk", type: AttrType.STRING } },
            { key: "print_suppression", partitionKey: { name: "accountId", type: AttrType.STRING }, sortKey: { name: "addrHash", type: AttrType.STRING } },

            // the GLOBAL, cross-account, contact-free address database (print-2.7/2.8) — ONE table, two row
            // shapes sharing a partition: sk="META" is the VerifiedAddress verification record, sk="ACCT#
            // <accountId>" is an AddressUsage charge-once-per-account row. NO contact/name anywhere in this
            // table — see SPECS.md gap #8 (a deliberate, controlled exception to per-account tenant isolation).
            { key: "print_address", partitionKey: { name: "addrHash", type: AttrType.STRING }, sortKey: { name: "sk", type: AttrType.STRING } },

            // `WorkQueue` governor tables (packages/services/src/WorkQueue.ts) — print's adoption for paced
            // batch submission (print-9.4), same shape as voice's.
            { key: "wq_jobs", partitionKey: { name: "queue", type: AttrType.STRING }, sortKey: { name: "jobId", type: AttrType.STRING },
              globalSecondaryIndexes: [
                  { name: "gsi_status_account", partitionKey: { name: "statusAccountPk", type: AttrType.STRING }, sortKey: { name: "createdAt", type: AttrType.STRING }, projection: "ALL" },
              ] },
            { key: "wq_queue_config",         partitionKey: { name: "queue", type: AttrType.STRING } },
            { key: "wq_account_config",       partitionKey: { name: "accountId", type: AttrType.STRING } },
            { key: "wq_account_queue_config", partitionKey: { name: "accountId", type: AttrType.STRING }, sortKey: { name: "queue", type: AttrType.STRING } },
        ],

        // ElastiCache Serverless (Redis) — the `WorkQueue` governor's ACTIVITY store, resolved via the default
        // logical key `"cache"` (`new Cache(cloud)`).
        caches:
        [
            { key: "cache", description: "WorkQueue governor activity store (fairness/rate-limit metrics)" },
        ],

        queues:
        [
            { key: "print-render",   maxReceiveCount: 3, dlq: true, visibilityTimeoutSec: 60 },
            { key: "print-submit",   maxReceiveCount: 3, dlq: true, visibilityTimeoutSec: 120 },
            { key: "print-tracking", maxReceiveCount: 3, dlq: true, visibilityTimeoutSec: 60 },
        ],
    },

    // S2S: template images resolve through media's asset library (best-effort — same pattern as voice/social).
    uses:
    [
        { service: "media", kind: ResourceKind.SERVICE, key: "main", access: AccessIntent.INVOKE },
    ],

    // Kafka — each tracking scan is also recorded as a canonical engagement event for analytics
    // (analytics-1.7); PrintService.emitEngagementEvent is the emitting site.
    publishes: [ { topic: Events.Stream.ENGAGEMENT } ],

    tags: { domain: "core", tier: "service" },
};

export default manifest;
// eof
