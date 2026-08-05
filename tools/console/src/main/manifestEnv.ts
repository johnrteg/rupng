import { readFileSync } from "node:fs";
import { join } from "node:path";

import { serviceDir } from "./paths";

//
// Runtime env discovery. Mirrors ports.ts: rather than importing a service's CloudManifest.ts (Electron's
// main process can't cheaply run repo TypeScript), the console parses the file's `environment: { … }`
// object literal(s) at runtime. So a manifest-declared var (e.g. `LOG_LEVEL: "info"`) reaches a LOCAL
// `npm run dev` run the same way it reaches a deployed container — no console rebuild needed. Parsed
// result is cached per service; `invalidateManifestEnv()` clears it (called on Rescan).
//

const cache = new Map<string, Record<string, string>>();

/** A service's manifest-declared `environment` vars (string values only), keyed by name. `{}` if the
 *  service has no CloudManifest.ts or no `environment` block. `SERVICE_ROLE` is excluded — the console
 *  derives that itself per spawned role, so the manifest's copy would only ever be stale/wrong here. */
export function manifestEnv( service : string ) : Record<string, string>
{
    const hit : Record<string, string> | undefined = cache.get( service );
    if ( hit ) return hit;
    const parsed : Record<string, string> = parse( service );
    cache.set( service, parsed );
    return parsed;
}

export function invalidateManifestEnv() : void
{
    cache.clear();
}

/** Parse every `environment: { KEY: "value", … }` object literal in a service's CloudManifest.ts, merging
 *  them (later blocks — e.g. a second role — win on a key clash). Returns `{}` if the file is missing or
 *  has no such block. */
function parse( service : string ) : Record<string, string>
{
    let text : string;
    try { text = readFileSync( join( serviceDir( service ), "src", "CloudManifest.ts" ), "utf8" ); }
    catch { return {}; }

    const env : Record<string, string> = {};
    const blockRe : RegExp = /environment\s*:\s*\{([^{}]*)\}/g;
    let blockMatch : RegExpExecArray | null;
    while ( ( blockMatch = blockRe.exec( text ) ) !== null )
    {
        const pairRe : RegExp = /(\w+)\s*:\s*"([^"]*)"/g;
        let pairMatch : RegExpExecArray | null;
        while ( ( pairMatch = pairRe.exec( blockMatch[ 1 ] ) ) !== null )
        {
            if ( pairMatch[ 1 ] === "SERVICE_ROLE" ) continue;   // role-derived — the console sets this itself
            env[ pairMatch[ 1 ] ] = pairMatch[ 2 ];
        }
    }
    return env;
}
