//
// Static OpenAPI generator — writes the published API's OpenAPI 3.1 document to `openapi.json` for readme.io
// sync / SDK generation / CI drift checks. It's the SAME document the live `GET /api/app/v1/openapi.json`
// serves (both call PublicApi.document), so the file can't diverge from the running API.
//
//   Run:   npm run openapi            (writes ./openapi.json)
//   Sync:  npx rdme openapi upload ./openapi.json --key=$README_KEY    (CI, on release)
//
// Note: resolves `@repo/api` via its built output — run `npm run build` first (or in CI before this). The
// always-available alternative needs no build: `curl <app-edge>/api/app/v1/openapi.json > openapi.json`.
//
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { PublicApi } from "@repo/api";
import type { RestfulEndpoint } from "@repo/endpoint";

//
// build the document from the curated PUBLIC registry and write it pretty-printed to the repo root
//
function main() : void
{
    const document : RestfulEndpoint.OpenApi.Document = PublicApi.document();
    const outPath  : string = resolve( process.cwd(), "openapi.json" );
    writeFileSync( outPath, `${ JSON.stringify( document, null, 2 ) }\n`, "utf-8" );

    const pathCount : number = Object.keys( document.paths ).length;
    console.log( `openapi: wrote ${ outPath } — ${ pathCount } published path(s), version ${ document.info.version }` );
}

main();
