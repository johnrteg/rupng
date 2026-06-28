//
// web — CloudManifest: the service's AWS footprint (a resource manifest, no CDK/AWS coupling).
//
// Hosting is split by environment:
//   • LOCAL / dev → S3 + CloudFront. The build stage runs vite (outDir `bin`), and the CDK stack
//     uploads that build into a PUBLIC_CDN bucket behind a CloudFront distribution (SPA routing).
//     Works on LocalStack, so the console's build → deploy pipeline drives it end to end.
//   • PRODUCTION → AWS Amplify Hosting (managed SSL / CDN / previews). Amplify isn't emulated by
//     LocalStack, so the ServiceStack skips it under `local` — it provisions only on real AWS.
//
import { ResourceManifest, BucketAccess } from "@repo/cloud-manifest";

export const manifest : ResourceManifest =
{
    service     : "web",
    description : "Web SPA — React app (S3 + CloudFront locally, Amplify Hosting in production)",
    tracing     : true,

    owns:
    {
        // Static-site hosting for LOCAL/dev: the built SPA (apps/core/web/bin) served via CloudFront + OAC.
        buckets:
        [
            {
                key    : "site",
                access : BucketAccess.PUBLIC_CDN,
                cdn    :
                {
                    staticSite : { source: "apps/core/web/bin", spa: true },
                    // The SPA calls the API on its own origin under the versioned /api namespace; route
                    // each service's prefix to its gateway (CloudFront → API Gateway), like the local
                    // webproxy. /api/{service}/* catches every version (v1, v2, …). Everything else
                    // (index.html, assets, themes, localization, SPA routes) stays on S3. Keep in sync
                    // with the webproxy upstreams. Only app + auth are live today; add prefixes as services land.
                    apiRoutes  : [ { service: "app",  api: "api", prefixes: [ "/api/app" ] },
                                   { service: "auth", api: "api", prefixes: [ "/api/auth" ] } ],
                },
            },
        ],

        // Production hosting: Amplify Hosting (managed). Skipped under `local` (not emulated by LocalStack).
        // Connect `repository` when wiring prod; until then this is the app + branch footprint.
        amplify:
        [
            {
                key      : "web",
                branches : [ { name: "main", stage: "PRODUCTION" } ],
            },
        ],
    },

    publishes:  [],
    subscribes: [],

    tags: { domain: "core", tier: "web" },
};

export default manifest;
// eof
