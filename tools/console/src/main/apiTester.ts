import { request as httpRequest } from "node:http";
import { request as httpsRequest, type RequestOptions } from "node:https";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { ApiEndpointDef, ApiRequestSpec, ApiResponse, ProxyRoute, SavedRequest } from "../shared/types";
import { REPO_ROOT, serviceDir } from "./paths";
import { servicePorts } from "./ports";
import { listServices } from "./registry";

//
// API tester — the data side of the per-service "API" tab (a Postman-style client):
//   • discoverEndpoints — parse @repo/api's RestfulEndpoint defs for the service (method + path),
//   • sendRequest       — actually perform the HTTP call from the MAIN process (no CORS, any host),
//   • saved-request CRUD — named requests persisted IN THE REPO (apps/core/<svc>/api-requests.json),
//     so they're team-shareable / version-controlled (like a git-tracked Postman collection).
//

const API_SRC = join( REPO_ROOT, "packages", "api", "src" );

// ── endpoint discovery (best-effort parse of the RestfulEndpoint definitions) ────────────────────
const RE_CLASS  = /export\s+class\s+(\w+)\s+extends\s+RestfulEndpoint/;
const RE_METHOD = /method\s*[^=]*=\s*NetworkUtils\.Method\.(\w+)/;
const RE_URI_INLINE = /readonly\s+uri\s*[^=]*=\s*["']([^"']+)["']/;       // uri = "/health"
const RE_URI_CONST  = /export\s+const\s+URI\s*[^=]*=\s*["']([^"']+)["']/; // namespace URI = "/version"
// versioned paths are composed via apiPath("service", N, "/resource") → /api/service/vN/resource
const RE_API_PATH   = /apiPath\(\s*["']([^"']+)["']\s*,\s*(\d+)\s*,\s*["']([^"']+)["']\s*\)/;
// audience governs edge-reachability: APP/PUBLIC = edge (browser), INTERNAL = VPC-only (inter-service)
const RE_AUDIENCE   = /audience\b[^=]*=\s*RestfulEndpoint\.Audience\.(\w+)/;

/** Resolve an endpoint's path from the source: a string literal, or an apiPath(svc, v, res) call. */
function uriFrom( text : string ) : string | undefined
{
    const api = RE_API_PATH.exec( text );
    if ( api )
    {
        const res : string = api[ 3 ].startsWith( "/" ) ? api[ 3 ] : `/${api[ 3 ]}`;
        return `/api/${api[ 1 ]}/v${api[ 2 ]}${res}`;
    }
    return RE_URI_INLINE.exec( text )?.[ 1 ] ?? RE_URI_CONST.exec( text )?.[ 1 ];
}

/** api source folders to scan for a service: its own (app→app) + shared `common`. */
function groupsFor( service : string ) : string[]
{
    return [ service, "common" ].filter( ( g ) => existsSync( join( API_SRC, g ) ) );
}

function parseEndpoint( group : string, file : string ) : ApiEndpointDef | null
{
    let text : string;
    try { text = readFileSync( join( API_SRC, group, file ), "utf8" ); }
    catch { return null; }

    const cls = RE_CLASS.exec( text );
    if ( !cls ) return null;                                  // not an endpoint definition

    const methodEnum : string = RE_METHOD.exec( text )?.[ 1 ] ?? "GET";
    const path : string | undefined = uriFrom( text );
    if ( !path ) return null;

    const method : string = methodEnum.toUpperCase();
    // audience defaults to INTERNAL (the RestfulEndpoint base default) when not declared
    const audience : ApiEndpointDef[ "audience" ] = ( RE_AUDIENCE.exec( text )?.[ 1 ] as ApiEndpointDef[ "audience" ] ) ?? "INTERNAL";
    return {
        name    : cls[ 1 ],
        method,
        path,
        group,
        hasBody : method === "POST" || method === "PUT" || method === "PATCH",
        audience,
    };
}

/**
 * Which service VARIANT (role) each endpoint is registered on, by parsing the role-service files
 * (apps/core/<svc>/src/services/*.ts): the role from `super(…Role.X)` + the endpoints it registers
 * via `new <Endpoint>Impl(…)`. Returns endpoint-class → { role, port } (port from Ports.ts).
 */
function variantBindings( service : string ) : Map<string, { role : string; port : number }>
{
    const out = new Map<string, { role : string; port : number }>();
    const dir : string = join( serviceDir( service ), "src", "services" );
    if ( !existsSync( dir ) ) return out;

    const ports : Record<string, number> = servicePorts()[ service.toUpperCase() ] ?? {};

    for ( const f of readdirSync( dir ).filter( ( f ) => f.endsWith( ".ts" ) && !f.endsWith( ".test.ts" ) ) )
    {
        let text : string;
        try { text = readFileSync( join( dir, f ), "utf8" ); } catch { continue; }

        const roleMatch : RegExpExecArray | null = /super\s*\(\s*[^)]*Role\.(\w+)/.exec( text );
        if ( !roleMatch ) continue;                          // not a concrete role-service
        const role : string = roleMatch[ 1 ].toLowerCase();
        const port : number | undefined = ports[ role ];
        if ( port === undefined ) continue;

        // each `new <Endpoint>Impl(` binds that endpoint class to this role (convention: <Def> + "Impl")
        for ( const m of text.matchAll( /new\s+(\w+)Impl\s*\(/g ) )
            out.set( m[ 1 ], { role, port } );
    }
    return out;
}

/** Discover the service's endpoints (its api group + common), with the variant they're bound to. */
export function discoverEndpoints( service : string ) : ApiEndpointDef[]
{
    const out : ApiEndpointDef[] = [];
    for ( const group of groupsFor( service ) )
    {
        const dir : string = join( API_SRC, group );
        const files : string[] = readdirSync( dir ).filter( ( f ) => f.endsWith( ".ts" ) && !f.endsWith( ".test.ts" ) && f !== "index.ts" );
        for ( const f of files )
        {
            const ep : ApiEndpointDef | null = parseEndpoint( group, f );
            if ( ep ) out.push( ep );
        }
    }

    // attach the service variant (role + port) each endpoint is registered on
    const bindings = variantBindings( service );
    for ( const ep of out )
    {
        const b = bindings.get( ep.name );
        if ( b ) { ep.role = b.role; ep.port = b.port; }
    }

    return out.sort( ( a, b ) => a.path.localeCompare( b.path ) || a.method.localeCompare( b.method ) );
}

/**
 * Generate the LOCAL per-endpoint route table for the webproxy — the BROWSER edge (north-south). Only
 * EDGE-REACHABLE endpoints (audience APP/PUBLIC) are included; INTERNAL endpoints are VPC-only
 * inter-service calls and must never be reachable from the browser. Each edge endpoint (path under
 * /api/, bound to a role + port) → that role's local port. Derived from the SAME endpoint→role bindings
 * the cloud gateway is generated from, so it never drifts and no endpoint is ever hand-added. The role
 * lives only in `target`, never in `path` — splitting a service into more roles just re-generates this.
 */
export function localApiRoutes() : ProxyRoute[]
{
    const out : ProxyRoute[] = [];
    for ( const svc of listServices() )
    {
        if ( !svc.capabilities.scaffolded || svc.capabilities.isFrontend ) continue;
        for ( const ep of discoverEndpoints( svc.id ) )
        {
            if ( !ep.path.startsWith( "/api/" ) || !ep.port ) continue;          // versioned API, bound to a local role port
            if ( ep.audience !== "APP" && ep.audience !== "PUBLIC" ) continue;   // edge only — INTERNAL is inter-service
            out.push( { method: ep.method, path: ep.path, target: `http://localhost:${ep.port}` } );
        }
    }
    return out;
}

// ── sending a request (from the main process) ────────────────────────────────────────────────────
export function sendRequest( spec : ApiRequestSpec ) : Promise<ApiResponse>
{
    const started : number = Date.now();
    return new Promise<ApiResponse>( ( resolve ) =>
    {
        let url : URL;
        try { url = new URL( spec.url ); }
        catch ( err ) { resolve( errorResponse( `bad URL: ${( err as Error ).message}`, started ) ); return; }

        const lib = url.protocol === "https:" ? httpsRequest : httpRequest;
        const options : RequestOptions = { method: spec.method, headers: spec.headers };

        const req = lib( url, options, ( res ) =>
        {
            const chunks : Buffer[] = [];
            res.on( "data", ( c : Buffer ) => chunks.push( c ) );
            res.on( "end", () =>
            {
                const buf : Buffer = Buffer.concat( chunks );
                const headers : Record<string, string> = {};
                for ( const [ k, v ] of globalThis.Object.entries( res.headers ) )
                    headers[ k ] = Array.isArray( v ) ? v.join( ", " ) : String( v ?? "" );
                const status : number = res.statusCode ?? 0;
                resolve( {
                    ok          : status >= 200 && status < 400,
                    status,
                    statusText  : res.statusMessage ?? "",
                    headers,
                    body        : buf.toString( "utf8" ),
                    contentType : headers[ "content-type" ],
                    timeMs      : Date.now() - started,
                    size        : buf.length,
                } );
            } );
        } );

        req.setTimeout( spec.timeoutMs ?? 15000, () => { req.destroy(); resolve( errorResponse( `timeout after ${spec.timeoutMs ?? 15000}ms`, started ) ); } );
        req.on( "error", ( err ) => resolve( errorResponse( err.message, started ) ) );
        if ( spec.body !== undefined && spec.body !== "" && spec.method !== "GET" && spec.method !== "HEAD" ) req.write( spec.body );
        req.end();
    } );
}

function errorResponse( error : string, started : number ) : ApiResponse
{
    return { ok: false, status: 0, statusText: "", headers: {}, body: "", timeMs: Date.now() - started, size: 0, error };
}

// ── saved requests (committed in the repo, per service) ──────────────────────────────────────────
function savedPath( service : string ) : string
{
    return join( serviceDir( service ), "api-requests.json" );
}

export function listSaved( service : string ) : SavedRequest[]
{
    const p : string = savedPath( service );
    if ( !existsSync( p ) ) return [];
    try
    {
        const parsed = JSON.parse( readFileSync( p, "utf8" ) ) as { requests? : SavedRequest[] };
        return parsed.requests ?? [];
    }
    catch { return []; }
}

function writeSaved( service : string, requests : SavedRequest[] ) : void
{
    writeFileSync( savedPath( service ), JSON.stringify( { requests }, null, 4 ) + "\n" );
}

/** Upsert a saved request by id (or append if new); returns the full list. */
export function saveRequest( service : string, req : SavedRequest ) : SavedRequest[]
{
    const list : SavedRequest[] = listSaved( service );
    const idx : number = list.findIndex( ( r ) => r.id === req.id );
    if ( idx >= 0 ) list[ idx ] = req; else list.push( req );
    writeSaved( service, list );
    return list;
}

export function deleteRequest( service : string, id : string ) : SavedRequest[]
{
    const list : SavedRequest[] = listSaved( service ).filter( ( r ) => r.id !== id );
    writeSaved( service, list );
    return list;
}
