import { app } from "electron";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { ManifestDrift } from "../shared/types";
import { serviceDir } from "./paths";

//
// Manifest-drift tracking for the local↔LocalStack dev loop.
//
// "Local" mode runs a service's code locally but uses the AWS resources its stack already created in
// LocalStack (see processManager.deployedEnv). That holds until the service's AWS FOOTPRINT changes —
// add a bucket/table/queue/AppConfig profile, etc. — because the new resource (and the env var the
// CloudResolver reads) only exists after a `cdklocal deploy`. We detect that by HASHING the service's
// CloudManifest.ts: record the hash on each successful deploy, and flag drift when the current file
// hash differs. A drift = "redeploy to LocalStack to apply the manifest change". Code changes never
// touch the manifest, so they never drift — only footprint edits do.
//
// State lives in the console's userData dir (per-dev, outside the repo).
//

/** Absolute path to the per-dev drift-state file in the console's userData dir. */
function stateFile() : string { return join( app.getPath( "userData" ), "deploy-state.json" ); }

/** Read the service → last-deployed-manifest-hash map. Returns {} when the file is missing/corrupt. */
function readState() : Record<string, string>
{
    try { return JSON.parse( readFileSync( stateFile(), "utf8" ) ) as Record<string, string>; }
    catch { return {}; }
}

/** Persist the service → manifest-hash map (best-effort; failures are swallowed). */
function writeState( state : Record<string, string> ) : void
{
    try { writeFileSync( stateFile(), JSON.stringify( state, null, 2 ) + "\n" ); } catch { /* ignore */ }
}

/** Short content hash of a service's CloudManifest.ts (its AWS footprint). "" when the service has none. */
export function manifestHash( service : string ) : string
{
    const file : string = join( serviceDir( service ), "src", "CloudManifest.ts" );
    if ( !existsSync( file ) ) return "";
    try { return createHash( "sha256" ).update( readFileSync( file, "utf8" ) ).digest( "hex" ).slice( 0, 16 ); }
    catch { return ""; }
}

/** Record the manifest hash deployed to LocalStack now (call after a successful deploy). */
export function recordDeploy( service : string ) : void
{
    const hash : string = manifestHash( service );
    if ( !hash ) return;
    const state : Record<string, string> = readState();
    state[ service ] = hash;
    writeState( state );
}

/** Has the manifest changed since the last recorded LocalStack deploy? (false if never deployed.) */
export function manifestDrift( service : string ) : ManifestDrift
{
    const current  : string = manifestHash( service );
    const deployed : string | null = readState()[ service ] ?? null;
    return { current, deployed, drifted: deployed !== null && deployed !== current };
}
