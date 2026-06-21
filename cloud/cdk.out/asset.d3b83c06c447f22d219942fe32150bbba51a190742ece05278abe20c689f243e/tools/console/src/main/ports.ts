import { readFileSync } from "node:fs";
import { join } from "node:path";

import { REPO_ROOT } from "./paths";

//
// Runtime port discovery. Rather than duplicate the port registry, the console parses the ONE source
// of truth — packages/cloud-manifest/src/Ports.ts — at runtime. So a service added to Ports.ts gets
// its role/port (and thus health + the runtime role filter) with NO console rebuild and no catalog
// edit. Parsed result is cached; `invalidatePorts()` clears it (called on Rescan).
//
// Ports.ts shape (each service is an inner namespace of single-line `const ROLE = <port>`):
//   export namespace Ports {
//     export namespace APP  { export const MAIN = 8100; export const PUBLIC = 8101; }
//     export namespace AUTH { export const READER = 8110; export const WRITER = 8111; }
//   }
//

const PORTS_FILE = join( REPO_ROOT, "packages", "cloud-manifest", "src", "Ports.ts" );

/** service-name (UPPERCASE) → { role (lowercase) → port }. */
type PortMap = Record<string, Record<string, number>>;

let cache : PortMap | null = null;

export function servicePorts() : PortMap
{
    if ( cache ) return cache;
    cache = parse();
    return cache;
}

export function invalidatePorts() : void
{
    cache = null;
}

function parse() : PortMap
{
    let text : string;
    try { text = readFileSync( PORTS_FILE, "utf8" ); }
    catch { return {}; }

    const out : PortMap = {};

    // match only INNERMOST namespaces — body has no braces ([^{}]*), so the outer `Ports` wrapper
    // (whose body contains `{`) is skipped, and each service namespace is captured cleanly.
    const nsRe : RegExp = /namespace\s+(\w+)\s*\{([^{}]*)\}/g;
    let ns : RegExpExecArray | null;

    while ( ( ns = nsRe.exec( text ) ) !== null )
    {
        const name : string = ns[ 1 ].toUpperCase();
        const body : string = ns[ 2 ];

        const roles : Record<string, number> = {};
        const constRe : RegExp = /const\s+(\w+)\s*=\s*(\d+)/g;
        let c : RegExpExecArray | null;
        while ( ( c = constRe.exec( body ) ) !== null )
            roles[ c[ 1 ].toLowerCase() ] = Number( c[ 2 ] );

        if ( globalThis.Object.keys( roles ).length > 0 ) out[ name ] = roles;
    }

    return out;
}
