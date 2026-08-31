//
// collab — CloudManifest: the service's AWS footprint (a resource manifest, no CDK/AWS coupling).
//
// TWO ECS roles, deliberately different SHAPES (see ServiceStack.makeEcsService's public-ALB branch):
//   • "control" — the STATELESS REST control plane (room CRUD, membership, message history, config). Normal
//     internal-ALB-via-VpcLink shape, same as every other service — reached through the platform API Gateway.
//   • "room"    — the STATEFUL WebSocket room server. `loadBalancer.public: true` + `stickySessions` — a real,
//     internet-facing, cookie-sticky ALB reached DIRECTLY by browser clients (`wss://…`), NOT through the API
//     Gateway. This is the platform's first public-facing ALB; see apps/core/collab/SPECS.md's architecture
//     section for why a stateful room server can't sit behind Lambda/API-Gateway (no connection affinity).
//
// v1 SCOPE IS CHAT ONLY (rooms/DMs/presence) — no Y.js/Hocuspocus CRDT document co-editing, no S3 snapshot
// storage, no per-room KMS envelope encryption, no GDPR erasure job, no rate-limiting/audit-event jobs yet.
// Each is a documented, deferred gap in SPECS.md (mirrors how voice deferred STIR/SHAKEN).
//
import {
    ResourceManifest,
    ApiAuthorizer, LaunchType,
    AttrType,
    Ports,
    ResourceKind, AccessIntent,
} from "@repo/cloud-manifest";

export const manifest : ResourceManifest =
{
    service     : "collab",
    description : "Slack-like chat — rooms, DMs, presence (online/active/idle). v1 is chat-only; Y.js/Hocuspocus collaborative document editing + whiteboard are deferred (see SPECS.md).",
    tracing     : true,

    owns:
    {
        services:
        [
            {
                key             : "control",
                launchType      : LaunchType.FARGATE,
                containerPort   : Ports.COLLAB.MAIN,
                healthCheckPath : "/health",
                environment     : { SERVICE_ROLE: "control", LOG_LEVEL: "info" },
                sizing          : { default: { cpu: 1, memory: 2 }, production: { cpu: 2, memory: 4 } },
                autoscaling     : { default: { min: 1, max: 2, start: 1, targetCpuPercent: 60 },
                                    production: { min: 2, max: 6, start: 2, targetCpuPercent: 60 } },
                loadBalancer    : { public: false },
            },
            {
                key             : "room",
                launchType      : LaunchType.FARGATE,
                containerPort   : Ports.COLLAB.ROOM,
                healthCheckPath : "/health",
                environment     : { SERVICE_ROLE: "room", LOG_LEVEL: "info" },
                sizing          : { default: { cpu: 1, memory: 2 }, production: { cpu: 2, memory: 4 } },
                autoscaling     : { default: { min: 1, max: 2, start: 1, targetCpuPercent: 60 },
                                    production: { min: 2, max: 8, start: 2, targetCpuPercent: 60 } },
                // public + sticky: connection affinity is load-bearing here (the in-memory room registry
                // lives on ONE task) — see ServiceStack.makeEcsService. idleTimeoutSec keeps a quiet-but-open
                // WebSocket from being killed by the ALB's 60s default.
                loadBalancer    : { public: true, stickySessions: { durationSec: 86400 },
                                    limits: { default: { idleTimeoutSec: 3600 } } },
            },
        ],

        // API gateway (the front door) — routes ONLY the "control" role's REST surface. The "room" role is
        // NOT behind this gateway; it's reached directly via its own public ALB DNS (see cloud/src/app.ts /
        // web's collab socket URL config).
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
            { key: "config", application: "collab", profiles: [ { key: "settings" }, { key: "flags", type: "feature_flags" } ] },
        ],

        tables:
        [
            // rooms — the durable room record (name, visibility, owner, member list snapshot); SK roomId
            { key: "collab_rooms", partitionKey: { name: "accountId", type: AttrType.STRING }, sortKey: { name: "roomId", type: AttrType.STRING } },

            // members — room membership, modeled SEPARATELY from `collab_rooms` (DynamoDB can't GSI a list
            // attribute) so "list my rooms" is a real query: GSI userId -> roomId
            { key: "collab_members", partitionKey: { name: "roomId", type: AttrType.STRING }, sortKey: { name: "userId", type: AttrType.STRING },
              globalSecondaryIndexes: [
                  { name: "userId", partitionKey: { name: "userId", type: AttrType.STRING }, sortKey: { name: "roomId", type: AttrType.STRING }, projection: "ALL" },
              ] },

            // messages — chat history, per-item TTL'd (CollabConfig.messageTtlDays); SK createdAt#messageId
            // for a natural chronological scan within one room's partition
            { key: "collab_messages", partitionKey: { name: "roomId", type: AttrType.STRING }, sortKey: { name: "createdAtMessageId", type: AttrType.STRING },
              ttlAttribute: "expiresAt" },
        ],

        // ElastiCache Serverless (Redis) — the room registry (roomId -> server instance), live presence
        // (online/active/idle, TTL'd so a crashed connection self-expires), and cross-node pub/sub fan-out.
        // Same resource shape voice already established for its WorkQueue governor.
        caches:
        [
            { key: "cache", description: "Collab room registry + presence + cross-node pub/sub" },
        ],
    },

    // S2S: read auth's Cognito user pool id (no IAM grant needed — JWKS is public HTTPS) so the "room" role,
    // reached DIRECTLY with no API Gateway JWT authorizer in front, can verify Cognito JWTs itself at WS
    // connect (see CollabRoomServer's CognitoJwtVerifier usage). Requires auth to precede collab in
    // cloud/src/app.ts's manifests[] (it already does).
    uses:
    [
        { service: "auth", kind: ResourceKind.USER_POOL, key: "users", access: AccessIntent.READ },
    ],

    tags: { domain: "core", tier: "service" },
};

export default manifest;
// eof
