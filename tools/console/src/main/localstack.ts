import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";

import type { ClockSkew, LocalStackState } from "../shared/types";
import { CLOUD_DIR } from "./paths";

//
// LocalStack lifecycle — the shared dependency every local deploy needs. Wraps the cloud/ npm
// scripts (local:up / local:down) and queries docker for the container's state. Status drives a
// chip in the UI so you can see at a glance whether the local cloud is up before deploying.
//

// promise-returning wrapper around child_process.execFile (no shell, args passed as an array)
const exec = promisify( execFile );

const COMPOSE_FILE : string = join( "local", "docker-compose.yml" );

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

        // first non-blank output line; no line means no matching container (treat as stopped)
        const line : string | undefined = stdout.split( /\r?\n/ ).find( ( outputLine ) => outputLine.trim().length > 0 );
        if ( !line ) return { status: "stopped", ts: Date.now() };

        // line is tab-separated "name\tstate\tstatus"; name is unused, keep state + human status text
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

/**
 * Compare the LocalStack container's clock to the host's. Drift here silently breaks time-based codes
 * (TOTP MFA has a ±30s window), and a long-lived Docker Desktop VM can slip after a sleep/resume. We read
 * the container epoch and compare to the host epoch at the MIDPOINT of the `docker exec` call, so the
 * exec's own latency doesn't masquerade as skew.
 */
export async function localstackClockSkew() : Promise<ClockSkew>
{
    try
    {
        // resolve the running container's name (first match) — don't hardcode "localstack-main"
        const { stdout: names } = await exec( "docker", [ "ps", "--filter", "name=localstack", "--format", "{{.Names}}" ] );
        const container : string | undefined = names.split( /\r?\n/ ).map( ( name ) => name.trim() ).filter( Boolean )[ 0 ];
        if ( !container ) return { ok: false, detail: "LocalStack container not running", ts: Date.now() };

        const before : number = Date.now();
        const { stdout } = await exec( "docker", [ "exec", container, "date", "-u", "+%s" ] );
        const after  : number = Date.now();

        const containerSec : number = parseInt( stdout.trim(), 10 );
        if ( !Number.isFinite( containerSec ) ) return { ok: false, container, detail: "could not read container clock", ts: Date.now() };

        const hostSec : number = Math.round( ( ( before + after ) / 2 ) / 1000 );
        return { ok: true, skewSec: containerSec - hostSec, container, ts: Date.now() };
    }
    catch ( err )
    {
        return { ok: false, detail: ( err as Error ).message, ts: Date.now() };
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
