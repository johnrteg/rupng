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
    const apiPathMatch : RegExpExecArray | null = RE_API_PATH.exec( text );
    if ( apiPathMatch )
    {
        // apiPath groups: [1] service, [2] version, [3] resource — compose /api/<svc>/v<N>/<resource>
        const resource : string = apiPathMatch[ 3 ].startsWith( "/" ) ? apiPathMatch[ 3 ] : `/${apiPathMatch[ 3 ]}`;
        return `/api/${apiPathMatch[ 1 ]}/v${apiPathMatch[ 2 ]}${resource}`;
    }
    return RE_URI_INLINE.exec( text )?.[ 1 ] ?? RE_URI_CONST.exec( text )?.[ 1 ];
}

/** api source folders to scan for a service: its own (app→app) + shared `common`. */
function groupsFor( service : string ) : Array<string>
{
    return [ service, "common" ].filter( ( group ) => existsSync( join( API_SRC, group ) ) );
}

/** Parse one api source file into an endpoint def (class name, method, path, audience), or null if it isn't a RestfulEndpoint. */
function parseEndpoint( group : string, file : string ) : ApiEndpointDef | null
{
    let text : string;
    try { text = readFileSync( join( API_SRC, group, file ), "utf8" ); }
    catch { return null; }

    const classMatch : RegExpExecArray | null = RE_CLASS.exec( text );
    if ( !classMatch ) return null;                           // not an endpoint definition

    const methodEnum : string = RE_METHOD.exec( text )?.[ 1 ] ?? "GET";
    const path : string | undefined = uriFrom( text );
    if ( !path ) return null;

    const method : string = methodEnum.toUpperCase();
    // audience defaults to INTERNAL (the RestfulEndpoint base default) when not declared
    const audience : ApiEndpointDef[ "audience" ] = ( RE_AUDIENCE.exec( text )?.[ 1 ] as ApiEndpointDef[ "audience" ] ) ?? "INTERNAL";
    return {
        name    : classMatch[ 1 ],
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
    const bindings = new Map<string, { role : string; port : number }>();
    const dir : string = join( serviceDir( service ), "src", "services" );
    if ( !existsSync( dir ) ) return bindings;

    const ports : Record<string, number> = servicePorts()[ service.toUpperCase() ] ?? {};

    for ( const file of readdirSync( dir ).filter( ( name ) => name.endsWith( ".ts" ) && !name.endsWith( ".test.ts" ) ) )
    {
        let text : string;
        try { text = readFileSync( join( dir, file ), "utf8" ); } catch { continue; }

        const roleMatch : RegExpExecArray | null = /super\s*\(\s*[^)]*Role\.(\w+)/.exec( text );
        if ( !roleMatch ) continue;                          // not a concrete role-service
        const role : string = roleMatch[ 1 ].toLowerCase();
        const port : number | undefined = ports[ role ];
        if ( port === undefined ) continue;

        // each `new <Endpoint>Impl(` binds that endpoint class to this role (convention: <Def> + "Impl")
        for ( const implMatch of text.matchAll( /new\s+(\w+)Impl\s*\(/g ) )
            bindings.set( implMatch[ 1 ], { role, port } );
    }
    return bindings;
}

/** Discover the service's endpoints (its api group + common), with the variant they're bound to. */
export function discoverEndpoints( service : string ) : Array<ApiEndpointDef>
{
    const endpoints : Array<ApiEndpointDef> = [];
    for ( const group of groupsFor( service ) )
    {
        const dir : string = join( API_SRC, group );
        const files : Array<string> = readdirSync( dir ).filter( ( name ) => name.endsWith( ".ts" ) && !name.endsWith( ".test.ts" ) && name !== "index.ts" );
        for ( const file of files )
        {
            const endpoint : ApiEndpointDef | null = parseEndpoint( group, file );
            if ( endpoint ) endpoints.push( endpoint );
        }
    }

    // attach the service variant (role + port) each endpoint is registered on
    const bindings = variantBindings( service );
    for ( const endpoint of endpoints )
    {
        const binding = bindings.get( endpoint.name );
        if ( binding ) { endpoint.role = binding.role; endpoint.port = binding.port; }
    }

    return endpoints.sort( ( left, right ) => left.path.localeCompare( right.path ) || left.method.localeCompare( right.method ) );
}

// The DEV-LOCAL port each service serves its `/api/{service}` on. The dev proxy routes per-SERVICE
// (one combined process per service locally); the production reader/writer/scale-out split is the real
// API Gateway's job, not the dev proxy's. This map is the SINGLE declared source — derived from
// `Ports.ts` (the same port registry the services bind to), NOT by scraping `new <X>Impl(` out of
// service files (that role-parsing was brittle and silently broke routing on a refactor).
//
// Default = the service's MAIN role port. A few services serve their API from a non-main role locally
// (app's public edge, account's read role); override those here. Add a line only when a service's local
// API port isn't its MAIN role.
const LOCAL_API_ROLE : Record<string, string> = { app: "public", account: "read" };

/** The dev-local port a service serves its `/api` on (its MAIN role, or the declared override). */
function localApiPort( service : string ) : number | undefined
{
    const ports : Record<string, number> = servicePorts()[ service.toUpperCase() ] ?? {};
    const roleKey : string = LOCAL_API_ROLE[ service ] ?? "main";
    return ports[ roleKey ] ?? ports.main ?? globalThis.Object.values( ports )[ 0 ];
}

/**
 * Generate the LOCAL route table for the webproxy — the BROWSER edge (north-south). Only EDGE-REACHABLE
 * endpoints (audience APP/PUBLIC) are included; INTERNAL endpoints are VPC-only inter-service calls and
 * must never be reachable from the browser. Every endpoint of a service targets that service's single
 * dev-local port (`localApiPort`) — the proxy collapses these to one `/api/{service}` prefix. Endpoint
 * PATHS come from the `@repo/api` contracts (`discoverEndpoints`); the TARGET is the declared port map
 * above (no longer the brittle per-endpoint role parsing), so a service-side refactor can't break routing.
 */
export function localApiRoutes() : Array<ProxyRoute>
{
    const routes : Array<ProxyRoute> = [];
    for ( const svc of listServices() )
    {
        if ( !svc.capabilities.scaffolded || svc.capabilities.isFrontend ) continue;
        const port : number | undefined = localApiPort( svc.id );
        if ( port === undefined ) continue;
        for ( const endpoint of discoverEndpoints( svc.id ) )
        {
            if ( !endpoint.path.startsWith( "/api/" ) ) continue;                            // versioned API only
            if ( endpoint.audience !== "APP" && endpoint.audience !== "PUBLIC" ) continue;   // edge only — INTERNAL is inter-service
            // route to the endpoint's OWN role port when known (discoverEndpoints binds each endpoint to the
            // role that registers it) — so a service whose edge endpoints span roles (e.g. media MAIN + BROWSE)
            // reaches each role's process. Falls back to the service's main/declared local API port.
            const target : number = endpoint.port && endpoint.port > 0 ? endpoint.port : port;
            routes.push( { method: endpoint.method, path: endpoint.path, target: `http://localhost:${target}` } );
        }
    }
    return routes;
}

// ── sending a request (from the main process) ────────────────────────────────────────────────────
/** Perform the HTTP(S) call described by `spec` from the main process and resolve a structured response (never rejects). */
export function sendRequest( spec : ApiRequestSpec ) : Promise<ApiResponse>
{
    const started : number = Date.now();
    return new Promise<ApiResponse>( ( resolve ) =>
    {
        let url : URL;
        try { url = new URL( spec.url ); }
        catch ( err ) { resolve( errorResponse( `bad URL: ${( err as Error ).message}`, started ) ); return; }

        const requestFn : typeof httpRequest = url.protocol === "https:" ? httpsRequest : httpRequest;
        const options : RequestOptions = { method: spec.method, headers: spec.headers };

        const req : ReturnType<typeof httpRequest> = requestFn( url, options, ( res ) =>
        {
            const chunks : Array<Buffer> = [];
            res.on( "data", ( chunk : Buffer ) => chunks.push( chunk ) );
            res.on( "end", () =>
            {
                const buffer : Buffer = Buffer.concat( chunks );
                const headers : Record<string, string> = {};
                // flatten node's string | Array<string> header values into a single string per key
                for ( const [ key, value ] of globalThis.Object.entries( res.headers ) )
                    headers[ key ] = Array.isArray( value ) ? value.join( ", " ) : String( value ?? "" );
                const status : number = res.statusCode ?? 0;
                resolve( {
                    ok          : status >= 200 && status < 400,
                    status,
                    statusText  : res.statusMessage ?? "",
                    headers,
                    body        : buffer.toString( "utf8" ),
                    contentType : headers[ "content-type" ],
                    timeMs      : Date.now() - started,
                    size        : buffer.length,
                } );
            } );
        } );

        req.setTimeout( spec.timeoutMs ?? 15000, () => { req.destroy(); resolve( errorResponse( `timeout after ${spec.timeoutMs ?? 15000}ms`, started ) ); } );
        req.on( "error", ( err ) => resolve( errorResponse( err.message, started ) ) );
        if ( spec.body !== undefined && spec.body !== "" && spec.method !== "GET" && spec.method !== "HEAD" ) req.write( spec.body );
        req.end();
    } );
}

/** Build a failed-call ApiResponse carrying the elapsed time and an error message. */
function errorResponse( error : string, started : number ) : ApiResponse
{
    return { ok: false, status: 0, statusText: "", headers: {}, body: "", timeMs: Date.now() - started, size: 0, error };
}

// ── saved requests (committed in the repo, per service) ──────────────────────────────────────────
/** Path to the service's committed saved-requests file (apps/core/<svc>/api-requests.json). */
function savedPath( service : string ) : string
{
    return join( serviceDir( service ), "api-requests.json" );
}

/** Read the service's saved requests (empty list if the file is missing or unparseable). */
export function listSaved( service : string ) : Array<SavedRequest>
{
    const path : string = savedPath( service );
    if ( !existsSync( path ) ) return [];
    try
    {
        const parsed = JSON.parse( readFileSync( path, "utf8" ) ) as { requests? : Array<SavedRequest> };
        return parsed.requests ?? [];
    }
    catch { return []; }
}

/** Persist the full saved-requests list back to the service's api-requests.json. */
function writeSaved( service : string, requests : Array<SavedRequest> ) : void
{
    writeFileSync( savedPath( service ), JSON.stringify( { requests }, null, 4 ) + "\n" );
}

/** Upsert a saved request by id (or append if new); returns the full list. */
export function saveRequest( service : string, req : SavedRequest ) : Array<SavedRequest>
{
    const list : Array<SavedRequest> = listSaved( service );
    const idx : number = list.findIndex( ( saved ) => saved.id === req.id );
    if ( idx >= 0 ) list[ idx ] = req; else list.push( req );
    writeSaved( service, list );
    return list;
}

/** Remove the saved request with the given id; returns the remaining list. */
export function deleteRequest( service : string, id : string ) : Array<SavedRequest>
{
    const list : Array<SavedRequest> = listSaved( service ).filter( ( saved ) => saved.id !== id );
    writeSaved( service, list );
    return list;
}
