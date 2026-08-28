//
// fake-email — CloudManifest: a DEV-ONLY simulated email provider (a "fake ESP"). It is a LEAF service — no
// Kafka, no DynamoDB/SQS (messages live in-memory), no platform Authorizer (fake-key auth only). It is NOT
// registered in the CDK app (`cloud/src/app.ts`) and NEVER deployed to prod; this manifest exists only so local
// tooling (the Console process registry) can discover + run it like any other service.
//
import {
    ResourceManifest,
    ApiAuthorizer, LaunchType,
    Ports,
} from "@repo/cloud-manifest";

export const manifest : ResourceManifest =
{
    service     : "fake-email",
    description : "DEV-ONLY simulated email provider (fake ESP) — representative send API + inbox + behavior knobs. Never deployed to prod.",
    tracing     : false,

    owns:
    {
        // The single ECS-style role — the fake ESP API on the FAKE_EMAIL port (9100).
        services:
        [
            {
                key             : "main",
                launchType      : LaunchType.FARGATE,
                containerPort   : Ports.FAKE_EMAIL.MAIN,
                healthCheckPath : "/health",
                environment     : { SERVICE_ROLE: "main", LOG_LEVEL: "info" },
                sizing          : { default: { cpu: 1, memory: 2 } },
                autoscaling     : { default: { min: 1, max: 1, start: 1, targetCpuPercent: 80 } },
                loadBalancer    : { public: false },
            },
        ],

        // No API gateway registration beyond health/version — the fake is reached DIRECTLY at its port by the
        // Console + the email service's FAKE adapter (it authenticates by fake key, not the platform Authorizer).
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

    tags: { domain: "core", tier: "dev-fake" },
};

export default manifest;
// eof
