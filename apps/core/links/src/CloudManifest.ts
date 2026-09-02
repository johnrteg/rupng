//
// links — CloudManifest: the service's AWS footprint (resource manifest, no CDK/AWS coupling). See
// apps/core/links/SPECS.md for the full design. MVP cut — ONE role (MAIN: mint + resolve + domain
// registry combined). Deferred (see SPECS.md's gap register + Service & Job topology note):
//   * The LinksMintService/LinksResolveService split — a dedicated always-up, independently-scaled
//     redirect tier — isn't built; MAIN serves both today.
//   * Real short-domain custom-domain routing (CloudFront + ACM + Route53 per ShortDomain) — resolve
//     runs on this service's own versioned path (`/links/r/:code`), not `<short-domain>/<code>`.
//   * Whitelabel DNS/cert automation (links-5.6), PURL landing render (links-3.2), conversion
//     threading (links-4.3), cost-cap metering (links-10.3), rate limiting (links-8.4), and the full
//     abuse subsystem (report/hibernate/restore/scan — links-10) are NOT built.
//
import {
    ResourceManifest,
    ApiAuthorizer, LaunchType,
    AttrType,
    Ports,
} from "@repo/cloud-manifest";
import { Events } from "@repo/system";

export const manifest : ResourceManifest =
{
    service     : "links",
    description : "The platform's one tracked-link system — mint, resolve/redirect, QR render, and the short-domain registry. MVP: single combined role, no real custom-domain routing yet.",
    tracing     : true,

    owns:
    {
        services:
        [
            {
                key             : "main",
                launchType      : LaunchType.FARGATE,
                containerPort   : Ports.LINKS.MAIN,
                healthCheckPath : "/health",
                environment     : { SERVICE_ROLE: "main", LOG_LEVEL: "info" },
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
            throttle   : { default: { rateLimit: 200, burstLimit: 400 },
                           production: { rateLimit: 1000, burstLimit: 2000 } },
            endpoints  :
            [
                { method: "GET", path: "/version", public: true, authRequired: false },
                { method: "GET", path: "/health",  public: true, authRequired: false },
            ],
        },

        // links — the TrackedLink mapping. PK is `code` ALONE (not accountId-partitioned like most
        // tables): the public resolve path only has the code, not the account, so the global opaque
        // code IS the lookup key (links-1.5 — collision-checked at mint over an ~218-trillion
        // keyspace). gsi_contactId serves the GDPR-erase fan-out (links-7.2).
        // domains — the ShortDomain registry, PK `domain`. gsi_list is the "list everything" pattern
        // (a constant-partition GSI) since the registry is platform-scale, not account-scale, and
        // there's no raw Scan on the Dynamo facade.
        tables:
        [
            { key: "links", partitionKey: { name: "code", type: AttrType.STRING },
              globalSecondaryIndexes: [
                  { name: "gsi_contactId", partitionKey: { name: "accountId", type: AttrType.STRING }, sortKey: { name: "contactId", type: AttrType.STRING }, projection: "ALL" },
              ] },
            { key: "domains", partitionKey: { name: "domain", type: AttrType.STRING },
              globalSecondaryIndexes: [
                  { name: "gsi_list", partitionKey: { name: "listKey", type: AttrType.STRING }, projection: "ALL" },
              ] },
        ],

        // links-touch — record-then-redirect's async half (links-2.2): resolve enqueues, the MAIN
        // role's local drain (a Job Lambda in a deploy) builds + publishes the engagement event.
        queues:
        [
            { key: "links-touch", maxReceiveCount: 3, dlq: true, visibilityTimeoutSec: 30 },
        ],
    },

    // No `uses` — links calls nothing cross-service; mint/erase are called BY other services.

    // Kafka — every click/scan is a canonical engagement event for analytics (analytics-1.7, links-4.1).
    publishes: [ { topic: Events.Stream.ENGAGEMENT } ],

    tags: { domain: "core", tier: "service" },
};

export default manifest;
// eof
