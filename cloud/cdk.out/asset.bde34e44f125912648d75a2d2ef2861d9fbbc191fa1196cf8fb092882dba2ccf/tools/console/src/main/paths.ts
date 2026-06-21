import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

//
// Repo-root resolution. The console lives at <repo>/tools/console; at runtime the bundled main
// process sits under tools/console/out/main. We walk up looking for the monorepo markers
// (turbo.json + apps/core) so the console works regardless of how it was launched (dev or packaged),
// and so it can drive turbo / docker / cdklocal from the right cwd.
//
function findRepoRoot() : string
{
    // start from this file's dir and climb
    let dir = __dirname;

    for ( let i = 0; i < 8; i++ )
    {
        if ( existsSync( join( dir, "turbo.json" ) ) && existsSync( join( dir, "apps", "core" ) ) )
        {
            return dir;
        }

        const parent : string = dirname( dir );
        if ( parent === dir ) break;
        dir = parent;
    }

    // fallback: <this>/../../../.. (tools/console/out/main → repo root)
    return resolve( __dirname, "..", "..", "..", ".." );
}

export const REPO_ROOT = findRepoRoot();

export const APPS_CORE = join( REPO_ROOT, "apps", "core" );
export const CLOUD_DIR = join( REPO_ROOT, "cloud" );

/** Where the console persists every stream's output so Claude Code (and you) can read it later. */
export const LOG_DIR = join( REPO_ROOT, "tools", "console", ".logs" );

/** apps/core/<id> */
export function serviceDir( id : string ) : string
{
    return join( APPS_CORE, id );
}
