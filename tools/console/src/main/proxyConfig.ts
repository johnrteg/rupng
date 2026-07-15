import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { ProxyConfig } from "../shared/types";
import { WEBPROXY_ID } from "../shared/types";
import { serviceDir } from "./paths";

//
// Read/write the webproxy's per-environment config files (apps/core/webproxy/src/config/<name>.json).
// Each file points the SPA root + each API/WS prefix at a target host — so switching "which host to
// call" is purely a config edit. These are git-tracked, shared with the team.
//

function configDir() : string { return join( serviceDir( WEBPROXY_ID ), "src", "config" ); }
function configPath( name : string ) : string { return join( configDir(), `${name}.json` ); }

/** The generated, per-developer config the console runs the proxy with (gitignored). */
export const ACTIVE_CONFIG = ".active";
export function activeConfigExists() : boolean { return existsSync( configPath( ACTIVE_CONFIG ) ); }

/** The available config names (file basenames), e.g. ["local","development","staging","production"]. */
export function listProxyConfigs() : Array<string>
{
    const dir : string = configDir();
    if ( !existsSync( dir ) ) return [];
    return readdirSync( dir )
        .filter( ( fileName : string ) => fileName.endsWith( ".json" ) )
        .map( ( fileName : string ) => fileName.slice( 0, -5 ) )   // strip the ".json" extension → bare config name
        .sort();
}

/** Read + parse a named config file; returns either the parsed config or a human-readable error. */
export function readProxyConfig( name : string ) : { config? : ProxyConfig; error? : string }
{
    const path : string = configPath( name );
    if ( !existsSync( path ) ) return { error: `no config "${name}.json"` };
    try { return { config: JSON.parse( readFileSync( path, "utf8" ) ) as ProxyConfig }; }
    catch ( err ) { return { error: ( err as Error ).message }; }
}

/** Serialize + write a named config file (4-space JSON, trailing newline). */
export function writeProxyConfig( name : string, config : ProxyConfig ) : { ok : boolean; error? : string }
{
    try
    {
        writeFileSync( configPath( name ), JSON.stringify( config, null, 4 ) + "\n" );
        return { ok: true };
    }
    catch ( err ) { return { ok: false, error: ( err as Error ).message }; }
}

/** Write the generated routing config the proxy actually runs with (per-dev, gitignored). */
export function writeActiveConfig( config : ProxyConfig ) : { ok : boolean; error? : string }
{
    return writeProxyConfig( ACTIVE_CONFIG, config );
}
