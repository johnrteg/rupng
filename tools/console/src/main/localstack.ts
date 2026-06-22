import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";

import type { LocalStackState } from "../shared/types";
import { CLOUD_DIR } from "./paths";

//
// LocalStack lifecycle — the shared dependency every local deploy needs. Wraps the cloud/ npm
// scripts (local:up / local:down) and queries docker for the container's state. Status drives a
// chip in the UI so you can see at a glance whether the local cloud is up before deploying.
//

const exec = promisify( execFile );

const COMPOSE_FILE = join( "local", "docker-compose.yml" );

/** Query docker for a LocalStack container and report its state. */
export async function localstackStatus() : Promise<LocalStackState>
{
    try
    {
        const { stdout } = await exec(
            "docker",
            [ "ps", "-a", "--filter", "name=localstack", "--format", "{{.Names}}\t{{.State}}\t{{.Status}}" ],
            { cwd: CLOUD_DIR }
        );

        const line = stdout.split( /\r?\n/ ).find( ( l ) => l.trim().length > 0 );
        if ( !line ) return { status: "stopped", ts: Date.now() };

        const [ , state, statusText ] = line.split( "\t" );
        return {
            status : state === "running" ? "running" : "stopped",
            detail : statusText,
            ts     : Date.now()
        };
    }
    catch ( err )
    {
        // docker not installed / daemon down
        return { status: "unknown", detail: ( err as Error ).message, ts: Date.now() };
    }
}

/** Bring LocalStack up (detached). */
export async function localstackUp() : Promise<void>
{
    await exec( "docker", [ "compose", "-f", COMPOSE_FILE, "up", "-d" ], { cwd: CLOUD_DIR } );
}

/** Tear LocalStack down (and its volumes, matching cloud's local:down). */
export async function localstackDown() : Promise<void>
{
    await exec( "docker", [ "compose", "-f", COMPOSE_FILE, "down", "-v" ], { cwd: CLOUD_DIR } );
}
