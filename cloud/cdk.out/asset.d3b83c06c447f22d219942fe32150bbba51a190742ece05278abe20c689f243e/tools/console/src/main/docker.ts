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

function env() : NodeJS.ProcessEnv
{
    const path : string = [ "/opt/homebrew/bin", "/usr/local/bin", process.env.PATH ?? "" ].filter( Boolean ).join( delimiter );
    return { ...process.env, PATH: path };
}

interface PsRow { ID? : string; Names? : string; Image? : string; State? : string; Status? : string; }
interface StatRow { ID? : string; Name? : string; CPUPerc? : string; MemUsage? : string; MemPerc? : string; }

function parseJsonLines<T>( stdout : string ) : T[]
{
    return stdout.split( /\r?\n/ ).filter( ( l ) => l.trim().length > 0 )
        .map( ( l ) => { try { return JSON.parse( l ) as T; } catch { return null; } } )
        .filter( ( v ) : v is T => v !== null );
}

function kindOf( name : string ) : ContainerKind
{
    if ( name.startsWith( "ls-ecs-" ) ) return "ecs-task";
    if ( /lambda/i.test( name ) ) return "lambda";   // LocalStack lambda containers (ephemeral)
    if ( name.includes( "localstack" ) ) return "localstack";
    if ( name.startsWith( "rupapp-" ) ) return "service";
    return "infra";
}

/** List running containers merged with their live CPU/memory stats. */
export async function dockerContainers() : Promise<{ containers : ContainerInfo[]; error? : string }>
{
    let ps : PsRow[];
    try
    {
        const out : { stdout : string; stderr : string } = await exec( "docker", [ "ps", "--format", "{{json .}}" ], { env: env(), maxBuffer: 8 * 1024 * 1024 } );
        ps = parseJsonLines<PsRow>( out.stdout );
    }
    catch ( err )
    {
        const msg = ( err as Error ).message;
        return { containers: [], error: /ENOENT|not found/i.test( msg ) ? "docker is not on PATH" : `docker ps failed: ${msg}` };
    }

    // stats is best-effort (slower) — merge by short id if present
    const statsById : Map<string, StatRow> = new Map<string, StatRow>();
    try
    {
        const out : { stdout : string; stderr : string } = await exec( "docker", [ "stats", "--no-stream", "--format", "{{json .}}" ], { env: env(), maxBuffer: 8 * 1024 * 1024 } );
        for ( const s of parseJsonLines<StatRow>( out.stdout ) )
            if ( s.ID ) statsById.set( s.ID, s );
    }
    catch { /* stats optional */ }

    const containers : ContainerInfo[] = ps.map( ( c ) =>
    {
        const name = ( c.Names ?? "" ).split( "," )[ 0 ];
        const s : StatRow | undefined = c.ID ? statsById.get( c.ID ) : undefined;
        return {
            id         : c.ID ?? "",
            name,
            image      : c.Image ?? "",
            state      : c.State ?? "",
            status     : c.Status ?? "",
            kind       : kindOf( name ),
            cpuPercent : s?.CPUPerc,
            memUsage   : s?.MemUsage,
            memPercent : s?.MemPerc
        };
    } );

    return { containers };
}
