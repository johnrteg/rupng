//
// texting — CloudManifest: the service's AWS footprint (resource manifest, no CDK/AWS coupling).
// See apps/core/texting/SPECS.md for the full design (1900+ lines — number routing, rate gating,
// P2P workflow, drip, surveys, opt-out compliance, …). This is an MVP scaffold: ONE role (MAIN,
// draining its own queues locally, same posture as print/email), FAKE provider only. Everything in
// SPECS.md beyond send → DLR → send-log → analytics engagement event is explicitly deferred — see
// the file's own "MVP cut" comments (TextingService.ts) for the exact list.
//
import {
    ResourceManifest,
    ApiAuthorizer, LaunchType,
    AttrType,
    Ports,
    ResourceKind, AccessIntent,
} from "@repo/cloud-manifest";
import { Events, Providers } from "@repo/system";

export const manifest : ResourceManifest =
{
    service     : "texting",
    description : "SMS/MMS messaging — send (config-selected provider) → DLR → send-log → analytics engagement event. Real CPaaS adapters: Twilio, Telnyx(3), Bandwidth(3), Broadnet, Infobip, SignalWire, Sinch, Vonage, plus FAKE. Campaign number-selection (ALL/AREA_CODE/SINGLE) is wired via a registration event sync; rate gating, opt-out, inbound/conversations, P2P workflow, drip, and reply-sticky routing are still deferred (see SPECS.md).",
    tracing     : true,

    owns:
    {
        // ONE ECS Fargate role — the /texting/* API, also draining its own queues locally (dev
        // convenience; a real deploy would split this into TextingMainService/TextingWebhookService/
        // TextingSendWorker/TextingDlrJob per SPECS.md, deferred for the MVP cut).
        services:
        [
            {
                key             : "main",
                launchType      : LaunchType.FARGATE,
                containerPort   : Ports.TEXTING.MAIN,
                healthCheckPath : "/health",
                environment     : { SERVICE_ROLE: "main", LOG_LEVEL: "info" },
                sizing          : { default: { cpu: 1, memory: 2 }, production: { cpu: 2, memory: 4 } },
                autoscaling     : { default: { min: 1, max: 2, start: 1, targetCpuPercent: 60 },
                                    production: { min: 2, max: 6, start: 2, targetCpuPercent: 60 } },
                loadBalancer    : { public: false },
            },
        ],

        // API gateway. The service enforces auth itself → authorizer NONE.
        api:
        {
            key        : "api",
            authorizer : ApiAuthorizer.NONE,
            cors       : true,
            throttle   : { default: { rateLimit: 100, burstLimit: 200 },
                           production: { rateLimit: 500, burstLimit: 1000 } },
            endpoints  :
            [
                { method: "GET", path: "/version", public: true, authRequired: false },
                { method: "GET", path: "/health",  public: true, authRequired: false },
            ],
        },

        // messages — the send-log (texting-11.1). PK accountId, SK messageId; a GSI resolves an
        // inbound DLR's providerMessageId (stored as `providerCode`) back to its row.
        tables:
        [
            { key: "messages", partitionKey: { name: "accountId", type: AttrType.STRING }, sortKey: { name: "messageId", type: AttrType.STRING },
              globalSecondaryIndexes: [
                  { name: "gsi_providerMessageId", partitionKey: { name: "providerCode", type: AttrType.STRING }, projection: "ALL" },
              ] },
            // numbers — texting's own consumption-side mirror of Texting.NumberRecord (texting-4.6), synced
            // from registration's `registration.number` events (RegistrationSyncConsumer). PK accountId, SK
            // number — one query per account already scopes a campaign's candidate numbers, no GSI needed.
            { key: "numbers", partitionKey: { name: "accountId", type: AttrType.STRING }, sortKey: { name: "number", type: AttrType.STRING } },
            // campaigns — the small synced-fields cache (numberSelection/active/mps) send-time routing needs
            // from `registration.campaign` events; texting never reads registration's own table (no
            // cross-service DB reads — CLAUDE.md).
            { key: "campaigns", partitionKey: { name: "accountId", type: AttrType.STRING }, sortKey: { name: "campaignId", type: AttrType.STRING } },
        ],

        // Work queues (auto-DLQ): send-enqueue + inbound DLR.
        queues:
        [
            { key: "texting-send", maxReceiveCount: 3, dlq: true, visibilityTimeoutSec: 60 },
            { key: "texting-dlr",  maxReceiveCount: 3, dlq: true, visibilityTimeoutSec: 60 },
        ],

        // Provider credentials — ONE Secrets Manager entry per registered CPaaS (Providers.CATALOG's
        // `texting` scope), no value at provision time (CDK defaults to a random placeholder; the real key
        // is pushed out-of-band — see CLAUDE.md's "new provider secret" checklist). Registering here is what
        // makes a secretRef in TextingConfig.providers actually resolvable at runtime.
        secrets: Providers.forService( "texting" ).map( ( provider ) => ( { key: provider.secretKey, description: `${ provider.label } (${ provider.category })` } ) ),
    },

    // S2S: resolve a contact's phone at send time (no cross-service DB reads — CLAUDE.md).
    uses:
    [
        { service: "contact", kind: ResourceKind.SERVICE, key: "main", access: AccessIntent.INVOKE },
    ],

    // Kafka — every SENT/DELIVERED/FAILED outcome is also recorded as a canonical engagement event
    // for analytics (analytics-1.7); TextingService.emitEngagementEvent is the emitting site.
    publishes: [ { topic: Events.Stream.ENGAGEMENT } ],

    tags: { domain: "core", tier: "service" },
};

export default manifest;
// eof
