import {
    ResourceManifest,
    ApiAuthorizer, LaunchType, BucketAccess,
    AttrType,
    Ports,
    ResourceKind, AccessIntent,
} from "@repo/cloud-manifest";
import { Events } from "@repo/system";

//
// survey — CloudManifest: the service's AWS footprint. DynamoDB is the source of truth (definitions,
// distributions, responses, the PURL/submission-token store — survey owns its own TTL token store, NOT
// auth's `auth_actions`, per the no-cross-service-DB-reads rule). Two Fargate roles: MAIN (the authed
// /survey/* API; also drains the response/ingest/distribution queues locally, same pattern as email's MAIN)
// and FORM (the PUBLIC hosted-form capture ingress behind CloudFront + WAF, scaling apart from MAIN per
// survey-9.3). WorkQueue governs distribution fan-out (survey-9.6), same adoption shape as print/voice.
//
export const manifest : ResourceManifest =
{
    service     : "survey",
    description : "Collect structured responses (NPS/CSAT/polls/intake) delivered over the platform's channels — a channel-agnostic definition with per-channel runners (SMS via workflow, email/web via a hosted form), unified results, and external-provider ingestion.",
    tracing     : true,

    owns:
    {
        services:
        [
            {
                key             : "main",
                launchType      : LaunchType.FARGATE,
                containerPort   : Ports.SURVEY.MAIN,
                healthCheckPath : "/health",
                environment     : { SERVICE_ROLE: "main", LOG_LEVEL: "trace" },
                sizing          : { default: { cpu: 1, memory: 2 }, production: { cpu: 2, memory: 4 } },
                autoscaling     : { default: { min: 1, max: 2, start: 1, targetCpuPercent: 60 },
                                    production: { min: 2, max: 6, start: 2, targetCpuPercent: 60 } },
                loadBalancer    : { public: false },
            },
            {
                // the PUBLIC hosted-form ingress — unauthenticated, abuse-hardened, scales independently
                // of the authed API (survey-9.3).
                key             : "form",
                launchType      : LaunchType.FARGATE,
                containerPort   : Ports.SURVEY.FORM,
                healthCheckPath : "/health",
                environment     : { SERVICE_ROLE: "form", LOG_LEVEL: "trace" },
                sizing          : { default: { cpu: 1, memory: 2 }, production: { cpu: 2, memory: 4 } },
                autoscaling     : { default: { min: 1, max: 3, start: 1, targetCpuPercent: 60 },
                                    production: { min: 2, max: 10, start: 2, targetCpuPercent: 60 } },
                loadBalancer    : { public: true },   // internet-reachable — sits behind CloudFront + WAF
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
            { key: "config", application: "survey", profiles: [ { key: "settings" }, { key: "flags", type: "feature_flags" } ] },
        ],

        // CAPTCHA/Turnstile secret key — bot protection for the public hosted form (survey-7.2). Not a
        // per-provider registry (unlike email/voice/print) — one platform-wide challenge provider.
        secrets:
        [
            { key: "survey-captcha", description: "CAPTCHA/Turnstile secret key (bot protection for the public hosted form)" },
        ],

        tables:
        [
            { key: "survey_surveys", partitionKey: { name: "accountId", type: AttrType.STRING }, sortKey: { name: "surveyId", type: AttrType.STRING },
              globalSecondaryIndexes: [
                  { name: "status", partitionKey: { name: "accountId", type: AttrType.STRING }, sortKey: { name: "status", type: AttrType.STRING }, projection: "ALL" },
              ] },
            { key: "survey_distributions", partitionKey: { name: "accountId", type: AttrType.STRING }, sortKey: { name: "distributionId", type: AttrType.STRING },
              globalSecondaryIndexes: [
                  { name: "bySurvey", partitionKey: { name: "accountId", type: AttrType.STRING }, sortKey: { name: "surveyId", type: AttrType.STRING }, projection: "ALL" },
              ] },
            { key: "survey_responses", partitionKey: { name: "accountId", type: AttrType.STRING }, sortKey: { name: "responseId", type: AttrType.STRING },
              globalSecondaryIndexes: [
                  { name: "bySurvey", partitionKey: { name: "accountId", type: AttrType.STRING }, sortKey: { name: "surveyId", type: AttrType.STRING }, projection: "ALL" },
                  { name: "status",   partitionKey: { name: "accountId", type: AttrType.STRING }, sortKey: { name: "status",   type: AttrType.STRING }, projection: "ALL" },
              ] },
            // the PURL/submission-token store (survey-7.3) — survey's OWN TTL row, mirroring auth's
            // ActionStore shape (packages/api/src/auth/model/AuthAction.ts) but never sharing the table.
            { key: "survey_tokens", partitionKey: { name: "token", type: AttrType.STRING } },

            // `WorkQueue` governor tables (packages/services/src/WorkQueue.ts) — survey's adoption for
            // paced distribution fan-out (survey-9.6), same shape as print's/voice's.
            { key: "wq_jobs", partitionKey: { name: "queue", type: AttrType.STRING }, sortKey: { name: "jobId", type: AttrType.STRING },
              globalSecondaryIndexes: [
                  { name: "gsi_status_account", partitionKey: { name: "statusAccountPk", type: AttrType.STRING }, sortKey: { name: "createdAt", type: AttrType.STRING }, projection: "ALL" },
              ] },
            { key: "wq_queue_config",         partitionKey: { name: "queue", type: AttrType.STRING } },
            { key: "wq_account_config",       partitionKey: { name: "accountId", type: AttrType.STRING } },
            { key: "wq_account_queue_config", partitionKey: { name: "accountId", type: AttrType.STRING }, sortKey: { name: "queue", type: AttrType.STRING } },
        ],

        // ElastiCache Serverless (Redis) — the `WorkQueue` governor's ACTIVITY store (default logical key "cache").
        caches:
        [
            { key: "cache", description: "WorkQueue governor activity store (fairness/rate-limit metrics)" },
        ],

        // response-processing + external-result ingestion + distribution-dispatch work queues (fair-share).
        // MAIN drains all three locally (same pattern as email's MAIN); a deploy can later split these to
        // dedicated Job Lambdas without changing the domain code (survey-8.1/9.4-9.6).
        queues:
        [
            { key: "survey-response",     maxReceiveCount: 3, dlq: true, visibilityTimeoutSec: 60 },
            { key: "survey-ingest",        maxReceiveCount: 3, dlq: true, visibilityTimeoutSec: 60 },
            { key: "survey-distribution",  maxReceiveCount: 3, dlq: true, visibilityTimeoutSec: 120 },
        ],
    },

    // S2S: survey lands scores/tags on contact (survey-4.2), reads segments for audience (survey-3.2), and
    // compiles + places IVR calls via voice for the PHONE channel (survey-2.4).
    uses:
    [
        { service: "contact", kind: ResourceKind.SERVICE, key: "main", access: AccessIntent.INVOKE },
        { service: "voice",   kind: ResourceKind.SERVICE, key: "main", access: AccessIntent.INVOKE },
    ],

    // Kafka — every publish/response/completed outcome is also recorded for analytics + as a workflow
    // trigger (survey-5.2); SurveyService.emit is the emitting site.
    publishes: [ { topic: Events.Stream.ENGAGEMENT } ],

    tags: { domain: "core", tier: "service" },
};

export default manifest;
// eof
