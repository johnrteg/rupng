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
                cdn    : { staticSite: { source: "apps/core/web/bin", spa: true } },
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
