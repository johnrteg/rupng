import { execFile } from "node:child_process";
import { delimiter } from "node:path";
import { promisify } from "node:util";

import type { ContainerInfo, ContainerKind } from "../shared/types";

//
// Docker container monitoring — the "what's actually running, with CPU/memory" side of Monitor.
// LocalStack doesn't populate CloudWatch CPU/mem metrics, and the Develop-tab compose containers
// aren't CloudFormation resources at all, so `docker ps` + `docker stats` is the real source for
// BOTH worlds: the compose service containers AND the LocalStack ECS tasks.
//

const exec = promisify( execFile );

/** Process env with the common Homebrew/local bin dirs prepended so `docker` resolves under Electron. */
function env() : NodeJS.ProcessEnv
{
    const path : string = [ "/opt/homebrew/bin", "/usr/local/bin", process.env.PATH ?? "" ].filter( Boolean ).join( delimiter );
    return { ...process.env, PATH: path };
}

interface PsRow { ID? : string; Names? : string; Image? : string; State? : string; Status? : string; }
interface StatRow { ID? : string; Name? : string; CPUPerc? : string; MemUsage? : string; MemPerc? : string; }

/** Parse newline-delimited JSON (docker's `{{json .}}` output), skipping blank/unparseable lines. */
function parseJsonLines<T>( stdout : string ) : Array<T>
{
    return stdout.split( /\r?\n/ ).filter( ( line ) => line.trim().length > 0 )
        .map( ( line ) => { try { return JSON.parse( line ) as T; } catch { return null; } } )
        .filter( ( parsed ) : parsed is T => parsed !== null );
}

/** Classify a container by name into the kind the Monitor view groups by. */
function kindOf( name : string ) : ContainerKind
{
    if ( name.startsWith( "ls-ecs-" ) ) return "ecs-task";
    if ( /lambda/i.test( name ) ) return "lambda";   // LocalStack lambda containers (ephemeral)
    if ( name.includes( "localstack" ) ) return "localstack";
    if ( name.startsWith( "rupapp-" ) ) return "service";
    return "infra";
}

/** List running containers merged with their live CPU/memory stats. */
export async function dockerContainers() : Promise<{ containers : Array<ContainerInfo>; error? : string }>
{
    let ps : Array<PsRow>;
    try
    {
        const out : { stdout : string; stderr : string } = await exec( "docker", [ "ps", "--format", "{{json .}}" ], { env: env(), maxBuffer: 8 * 1024 * 1024 } );
        ps = parseJsonLines<PsRow>( out.stdout );
    }
    catch ( err )
    {
        const message : string = ( err as Error ).message;
        return { containers: [], error: /ENOENT|not found/i.test( message ) ? "docker is not on PATH" : `docker ps failed: ${message}` };
    }

    // stats is best-effort (slower) — merge by short id if present
    const statsById : Map<string, StatRow> = new Map<string, StatRow>();
    try
    {
        const out : { stdout : string; stderr : string } = await exec( "docker", [ "stats", "--no-stream", "--format", "{{json .}}" ], { env: env(), maxBuffer: 8 * 1024 * 1024 } );
        for ( const stat of parseJsonLines<StatRow>( out.stdout ) )
            if ( stat.ID ) statsById.set( stat.ID, stat );
    }
    catch { /* stats optional */ }

    const containers : Array<ContainerInfo> = ps.map( ( row : PsRow ) =>
    {
        const name : string = ( row.Names ?? "" ).split( "," )[ 0 ];
        const stat : StatRow | undefined = row.ID ? statsById.get( row.ID ) : undefined;
        return {
            id         : row.ID ?? "",
            name,
            image      : row.Image ?? "",
            state      : row.State ?? "",
            status     : row.Status ?? "",
            kind       : kindOf( name ),
            cpuPercent : stat?.CPUPerc,
            memUsage   : stat?.MemUsage,
            memPercent : stat?.MemPerc
        };
    } );

    return { containers };
}
