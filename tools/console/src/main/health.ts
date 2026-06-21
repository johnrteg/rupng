import { request } from "node:http";

import type { HealthResult, ServiceInfo, ServiceRole } from "../shared/types";
import { getService, listServices } from "./registry";

//
// Health pings. A backend role exposes GET /health on its local port; we hit it with a short timeout
// and report status + latency + parsed body. No SSL (everything is local http), per the brief.
//

const TIMEOUT_MS = 2500;

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
            const chunks : Buffer[] = [];
            res.on( "data", ( c : Buffer ) => chunks.push( c ) );
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
export async function pingHealth( service : string, role? : string ) : Promise<HealthResult[]>
{
    const svc : ServiceInfo | undefined = getService( service );
    if ( !svc || !svc.capabilities.canHealth ) return [];

    const roles : ServiceRole[] = role ? svc.roles.filter( r => r.role === role ) : svc.roles;
    return Promise.all( roles.filter( r => r.port > 0 ).map( r => pingUrl( service, r.role, r.port ) ) );
}

/** Ping every health-capable role of every service (the fleet overview). */
export async function pingAll() : Promise<HealthResult[]>
{
    const out : HealthResult[] = [];
    for ( const svc of listServices() )
    {
        if ( !svc.capabilities.canHealth ) continue;
        out.push( ...await pingHealth( svc.id ) );
    }
    return out;
}
