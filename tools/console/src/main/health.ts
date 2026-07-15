import { request } from "node:http";

import type { HealthResult, ServiceInfo, ServiceRole } from "../shared/types";
import { getService, listServices } from "./registry";
import { processManager } from "./processManager";

//
// Health pings. A backend role exposes GET /health; we hit it with a short timeout and report status +
// latency + parsed body. No SSL (everything is local http), per the brief.
//
// Where a role actually listens depends on HOW it's running:
//   • console-spawned local dev → the role's dev port (81xx)
//   • deployed to LocalStack (ECS via docker) → the role's container port is published to a RANDOM host
//     port (e.g. 8101 → 33934), resolved from `docker ps` (the same mapping the API tester uses).
// Pinging the dev port while deployed is exactly the "still references 8*** ports" bug — so we resolve
// the real port per run-mode below and report the port we actually hit.
//

const TIMEOUT_MS = 2500;

/** Issue GET /health to one role at the given port and resolve a HealthResult (never rejects; failures become ok:false). */
function pingUrl( service : string, role : string, port : number ) : Promise<HealthResult>
{
    const url   : string = `http://localhost:${port}/health`;
    const start : number = Date.now();

    return new Promise<HealthResult>( ( resolve ) =>
    {
        const finish = ( partial : Partial<HealthResult> ) : void =>
            resolve( {
                service, role, port, url,
                ok        : false,
                status    : 0,
                latencyMs : Date.now() - start,
                ts        : Date.now(),
                ...partial
            } );

        const req : ReturnType<typeof request> = request( url, { method: "GET", timeout: TIMEOUT_MS }, ( res ) =>
        {
            const chunks : Array<Buffer> = [];
            res.on( "data", ( chunk : Buffer ) => chunks.push( chunk ) );
            res.on( "end", () =>
            {
                const raw    : string = Buffer.concat( chunks ).toString( "utf8" ).slice( 0, 4000 );
                const status : number = res.statusCode ?? 0;
                let body : unknown = raw;
                try { body = raw ? JSON.parse( raw ) : ""; } catch { /* keep raw text */ }
                finish( { ok: status >= 200 && status < 400, status, body } );
            } );
        } );

        req.on( "timeout", () => { req.destroy(); finish( { error: `timeout after ${TIMEOUT_MS}ms` } ); } );
        req.on( "error", ( err ) => finish( { error: err.message } ) );
        req.end();
    } );
}

/** Ping one role (or the service's first/only role if `role` is omitted). */
export async function pingHealth( service : string, role? : string ) : Promise<Array<HealthResult>>
{
    const svc : ServiceInfo | undefined = getService( service );
    if ( !svc || !svc.capabilities.canHealth ) return [];

    const roles : Array<ServiceRole> = role ? svc.roles.filter( candidate => candidate.role === role ) : svc.roles;

    // Resolve the real listen port per run-mode: local dev uses the dev port; a deployed service uses its
    // published host port (containerPort → hostPort). `deployedPorts` shells out to `docker ps`, so do it
    // once per call (not per role), and skip it entirely when the service is running locally.
    const localRunning : boolean = processManager.isRunning( service, "runtime" );
    const deployed : Record<number, number> = localRunning ? {} : processManager.deployedPorts( service );

    return Promise.all( roles.filter( serviceRole => serviceRole.port > 0 ).map( serviceRole =>
    {
        const port : number = localRunning ? serviceRole.port : ( deployed[ serviceRole.port ] ?? serviceRole.port );
        return pingUrl( service, serviceRole.role, port );
    } ) );
}

/** Ping every health-capable role of every service (the fleet overview). */
export async function pingAll() : Promise<Array<HealthResult>>
{
    const out : Array<HealthResult> = [];
    for ( const svc of listServices() )
    {
        if ( !svc.capabilities.canHealth ) continue;
        out.push( ...await pingHealth( svc.id ) );
    }
    return out;
}
