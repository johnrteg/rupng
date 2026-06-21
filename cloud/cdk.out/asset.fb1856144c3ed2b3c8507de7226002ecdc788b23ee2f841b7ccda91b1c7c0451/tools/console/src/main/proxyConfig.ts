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

/** The available config names (file basenames), e.g. ["local","development","staging","production"]. */
export function listProxyConfigs() : string[]
{
    const dir : string = configDir();
    if ( !existsSync( dir ) ) return [];
    return readdirSync( dir )
        .filter( ( f ) => f.endsWith( ".json" ) )
        .map( ( f ) => f.slice( 0, -5 ) )
        .sort();
}

export function readProxyConfig( name : string ) : { config? : ProxyConfig; error? : string }
{
    const p : string = configPath( name );
    if ( !existsSync( p ) ) return { error: `no config "${name}.json"` };
    try { return { config: JSON.parse( readFileSync( p, "utf8" ) ) as ProxyConfig }; }
    catch ( err ) { return { error: ( err as Error ).message }; }
}

export function writeProxyConfig( name : string, config : ProxyConfig ) : { ok : boolean; error? : string }
{
    try
    {
        writeFileSync( configPath( name ), JSON.stringify( config, null, 4 ) + "\n" );
        return { ok: true };
    }
    catch ( err ) { return { ok: false, error: ( err as Error ).message }; }
}
