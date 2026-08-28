//
// realtime — CloudManifest: the service's AWS footprint (a resource manifest, no CDK/AWS coupling).
//
// PHASE 1 (current). A single MAIN role: consumes the Kafka firehose (every `Events.Object`, no push-set
// filtering yet — see SPECS.md gaps) and, for local dev, ALSO terminates the browser's raw WebSocket upgrade
// directly on this container (holding connections in-process, keyed by `accountId`). This is a deliberate
// simplification of the full design in SPECS.md — no DynamoDB connection registry, no API Gateway WebSocket +
// Lambda `$connect`/`$disconnect`, no Redis outbox/pacing/presence yet. Those land in a later phase once this
// needs to run as more than one instance (see SPECS.md "Service & Job topology").
//
import {
    ResourceManifest,
    ApiAuthorizer, LaunchType,
    Ports,
} from "@repo/cloud-manifest";
import { Events } from "@repo/system";   // Kafka topics = Events.Object (per-entity state change)

export const manifest : ResourceManifest =
{
    service     : "realtime",
    description : "Kafka -> browser WebSocket push bridge. Phase 1: single MAIN role, in-process connection map, no push-set filtering.",
    tracing     : true,

    owns:
    {
        // The single Fargate role — health/version + (dev-only) the raw WebSocket upgrade on the same port.
        services:
        [
            {
                key             : "main",
                launchType      : LaunchType.FARGATE,
                containerPort   : Ports.REALTIME.MAIN,
                healthCheckPath : "/health",
                environment     : { SERVICE_ROLE: "main", LOG_LEVEL: "info" },
                sizing          : { default: { cpu: 1, memory: 2 } },
                autoscaling     : { default: { min: 1, max: 1, start: 1, targetCpuPercent: 80 } },
                loadBalancer    : { public: false },
            },
        ],

        // No public API surface beyond health/version yet — push is the socket, not REST (SPECS.md realtime-9.2).
        api:
        {
            key        : "api",
            authorizer : ApiAuthorizer.NONE,
            cors       : true,
            throttle   : { default: { rateLimit: 100, burstLimit: 200 } },
            endpoints  :
            [
                { method: "GET", path: "/version", public: true, authRequired: false },
                { method: "GET", path: "/health",  public: true, authRequired: false },
            ],
        },
    },

    // Kafka — subscribes to the WHOLE entity-event vocabulary for now (no push-set filter yet; SPECS.md
    // realtime-3.0 is the future, curated, AppConfig-driven subset). Publishes nothing.
    subscribes: Object.values( Events.Object ).map( ( topic : Events.Object ) => ( { topic, consumerGroup: "realtime-broadcast" } ) ),

    tags: { domain: "core", tier: "service" },
};

export default manifest;
// eof
