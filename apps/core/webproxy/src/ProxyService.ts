//
// Proxy — a development front door. Serves the built web app (apps/core/web) as static files
// with SPA fallback, and reverse-proxies API + WebSocket traffic to a configurable upstream:
// LOCAL servers / LocalStack, or a deployed AWS environment (dev / staging / production).
// Which one is purely a config choice (`Array<upstreams>.target`); the same code serves all.
//
// Converted to the @repo/services `Service` base — which owns the Fastify instance, the
// run/init/start lifecycle, OS-signal shutdown, error handling, and /health — so this class
// only adds the proxy/static wiring.
//
import fs   from "fs";
import path from "path";
import { IncomingMessage } from "http";
import Stream from "stream";

import fastifyStatic    from "@fastify/static";
import fastifyHttpProxy from "@fastify/http-proxy";
import axios, { AxiosInstance, AxiosResponse } from "axios";
import WebSocket, { WebSocketServer } from "ws";
import { FastifyReply, FastifyRequest } from "fastify";

import { Application, Service, Register } from "@repo/services";


//////////////////////////////////////////////////////////////////////////////////////////////////
export class ProxyService extends Service
{
    private cfg!     : ProxyService.Config;          // loaded in getConfig() before start()
    private wss      : WebSocketServer;              // client-facing upgrade handler (noServer)
    private wsRoute? : ProxyService.WsRoute;         // resolved upstream WS target (first upstream with `ws`)

    ////////////////////////////////////////////////////////////////////////////////////////////////
    constructor()
    {
        // proxy defaults to 8080 (the dev front door); PORT overrides. No role — single-instance proxy.
        super( Register.Service.WEBPROXY, undefined, parseInt( process.env.PORT ?? "8080" ) );
        this.wss = new WebSocketServer( { noServer: true } );
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Config — selected by `--config <name>` or ENVIRONMENT, read from ./config/*.json
    // ──────────────────────────────────────────────────────────────────────────

    /** Base hook: load + cache the JSON config (extends Application.Config). */
    protected override async getConfig() : Promise<ProxyService.Config>
    {
        this.cfg ??= this.loadConfig();
        return this.cfg;
    }

    /////////////////////////////////////////////////////////////////////////////////////////
    /** Directory holding the per-environment config files (override with PROXY_CONFIG_DIR). */
    private configDir() : string { return process.env.PROXY_CONFIG_DIR ?? path.join( __dirname, "config" ); }

    /////////////////////////////////////////////////////////////////////////////////////////
    /** Pick the config name: `--config <name>` wins, else map ENVIRONMENT, else "production". */
    private selectConfigName() : string
    {
        const args : Array<string> = process.argv.slice( 2 );
        const i : number = args.indexOf( "--config" );
        if( i >= 0 && args[ i + 1 ] ) return args[ i + 1 ];

        const env : string = ( process.env.ENVIRONMENT ?? "" ).toLowerCase();
        const byEnv : Record<string, string> = {
            local: "local", dev: "development", development: "development",
            staging: "staging", prod: "production", production: "production",
        };
        return byEnv[ env ] ?? "production";
    }

    /////////////////////////////////////////////////////////////////////////////////////////
    /** Read + parse the selected config file. */
    private loadConfig() : ProxyService.Config
    {
        const name : string = this.selectConfigName();
        const file : string = path.join( this.configDir(), `${name}.json` );
        this.log.info( "proxy config", { name, file } );
        return JSON.parse( fs.readFileSync( file, "utf8" ) ) as ProxyService.Config;
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Server wiring — registered into the Fastify instance the base created
    // ──────────────────────────────────────────────────────────────────────────

    /////////////////////////////////////////////////////////////////////////////////////////
    /** Base hook (after the Fastify server exists, before listen): register everything. */
    protected override addServerRegister() : void
    {
        super.addServerRegister();      // @fastify/formbody

        this.registerStatic();
        this.registerRouteTable();      // LOCAL: per-endpoint → role-service dispatch (mirrors the gateway)
        this.registerProxies();         // REMOTE/static: prefix → single upstream (cloud edge, ws holder)
        this.registerWebSocketUpgrade();
        this.registerExtraRoutes();
        this.registerSpaFallback();     // must be last — it's the not-found handler
    }

    /////////////////////////////////////////////////////////////////////////////////////////
    /**
     * LOCAL mode: a generated per-endpoint route table. Each endpoint (method + path, with :params)
     * resolves to the role-service that registers it — so /api/auth/v1/login can hit the WRITER while
     * /api/auth/v1/session hits the READER, exactly as the production gateway routes per-route. One
     * proxy is mounted on /api; the upstream is chosen PER REQUEST via getUpstream, so the path is
     * forwarded unchanged. The role lives only in the target, never in the path — so splitting a
     * service into more roles just re-generates this table; URLs don't change.
     *
     * Generated by the console from the endpoint→role bindings. REMOTE mode emits no routes (the cloud
     * edge does the dispatch) — there a single /api prefix upstream (registerProxies) forwards to it.
     */
    private registerRouteTable() : void
    {
        if( !this.server || !this.cfg.routes?.length ) return;

        // Build PREFIX proxies from the per-endpoint route table. A service whose endpoints span multiple ports
        // (e.g. media MAIN 8240 + BROWSE 8241) can't be one `/api/{service}` prefix — so for each service we
        // mount its PRIMARY target (the one serving the most endpoints) at `/api/{service}`, and each OTHER
        // target at the LONGEST COMMON PATH-PREFIX of its endpoints (e.g. `/api/media/v1/browse` → 8241).
        // Fastify's router matches the most-specific prefix, so `/api/media/v1/browse/*` → 8241 while everything
        // else under `/api/media/*` → 8240 — per-sub-service routing without @fastify/http-proxy's `getUpstream`
        // (broken in 11.5.0: the returned upstream is computed but never applied, so every request 404s).
        const byService : Map<string, Map<string, Array<string>>> = new Map<string, Map<string, Array<string>>>();   // service → target → paths
        for( const route of this.cfg.routes )
        {
            const segments : Array<string> = route.path.split( "/" ).filter( Boolean );   // ["api","media","v1",…]
            if( segments[ 0 ] !== "api" || segments.length < 2 ) continue;
            const service : string = segments[ 1 ];
            if( !byService.has( service ) ) byService.set( service, new Map<string, Array<string>>() );
            const targets : Map<string, Array<string>> = byService.get( service )!;
            if( !targets.has( route.target ) ) targets.set( route.target, [] );
            targets.get( route.target )!.push( route.path );
        }

        // resolve (prefix → target) mounts: primary target at the service root, each other target at its
        // endpoints' common prefix. Register longest prefixes LAST so a more-specific mount wins the match.
        const mounts : Array<{ prefix : string; target : string }> = [];
        for( const [ service, targets ] of byService )
        {
            const ranked : Array<[ string, Array<string> ]> = [ ...targets.entries() ].sort( ( left, right ) => right[ 1 ].length - left[ 1 ].length );
            mounts.push( { prefix: `/api/${ service }`, target: ranked[ 0 ][ 0 ] } );   // primary → service root
            for( let index : number = 1; index < ranked.length; index++ )
            {
                const [ target, paths ] : [ string, Array<string> ] = ranked[ index ];
                const prefix : string = ProxyService.commonPathPrefix( paths );
                if( prefix === `/api/${ service }` )   // can't disambiguate — would collide with the primary mount
                    this.log.warn( "proxy route: sub-service shares the service prefix — cannot split-route", { service, target } );
                else
                    mounts.push( { prefix, target } );
            }
        }

        for( const { prefix, target } of mounts.sort( ( left, right ) => left.prefix.length - right.prefix.length ) )
        {
            this.log.info( "proxy route", { prefix, target } );
            this.server.register( fastifyHttpProxy, {
                upstream      : target,
                prefix,
                rewritePrefix : prefix,                   // forward the full /api/{service}/v{N}/… path unchanged
                http2         : false,
                replyOptions  : {
                    rewriteRequestHeaders : ( _req, headers ) => ( { ...headers, origin: target } ),
                },
            } );
        }
    }

    /////////////////////////////////////////////////////////////////////////////////////////
    /** The longest common leading path (by whole segments) across the given paths — used to mount a
     *  sub-service's endpoints at the deepest prefix they all share (e.g. `/api/media/v1/browse`). */
    private static commonPathPrefix( paths : Array<string> ) : string
    {
        if( paths.length === 0 ) return "";
        const segmented : Array<Array<string>> = paths.map( ( path : string ) => path.split( "/" ).filter( Boolean ) );
        const first : Array<string> = segmented[ 0 ];
        let shared : number = first.length;
        for( const segments of segmented )
        {
            let index : number = 0;
            while( index < shared && index < segments.length && segments[ index ] === first[ index ] ) index++;
            shared = index;
        }
        return "/" + first.slice( 0, shared ).join( "/" );
    }

    /////////////////////////////////////////////////////////////////////////////////////////
    /** Serve the built web app (apps/core/web) as static files. */
    private registerStatic() : void
    {
        if( !this.server ) return;

        const root : string = this.resolveWebRoot();

        // @fastify/static throws at registration if `root` is missing. The web app may not be
        // built yet — skip static (and serve API/WS only) rather than failing to boot.
        if( !fs.existsSync( root ) )
        {
            this.log.warn( "proxy static skipped — web root not found (build apps/core/web first)", { root } );
            return;
        }

        this.log.info( "proxy static", { root, prefix: this.cfg.web.prefix } );

        this.server.register( fastifyStatic, {
            root,
            prefix       : this.cfg.web.prefix,
            index        : [ this.cfg.web.index ],
            wildcard     : true,
            cacheControl : false,       // dev: never cache the SPA shell/assets
            maxAge       : 0,
            // The SPA shell (index.html) MUST NOT be browser-cached, or a normal refresh keeps loading the
            // old hashed asset refs (→ stale app even after a rebuild). Force revalidation on every HTML hit.
            setHeaders   : ( res : { setHeader( name : string, value : string ) : void }, filePath : string ) : void =>
            {
                if( filePath.endsWith( ".html" ) ) res.setHeader( "Cache-Control", "no-store, must-revalidate" );
            },
        } );
    }

    /////////////////////////////////////////////////////////////////////////////////////////
    /** Resolve the web root: absolute as-is, else relative to this module (PROXY_WEB_ROOT overrides). */
    private resolveWebRoot() : string
    {
        const root : string = process.env.PROXY_WEB_ROOT ?? this.cfg.web.root;
        return path.isAbsolute( root ) ? root : path.resolve( __dirname, root );
    }

    /////////////////////////////////////////////////////////////////////////////////////////
    /** Reverse-proxy each upstream's path prefixes to its target (local / LocalStack / AWS). */
    private registerProxies() : void
    {
        if( !this.server ) return;

        const hasRouteTable : boolean = !!this.cfg.routes?.length;

        for( const up of this.cfg.upstreams )
        {
            // remember the first upstream that exposes a websocket path
            if( this.wsRoute === undefined && up.ws ) this.wsRoute = this.resolveWsRoute( up );

            const rewriteOrigin : boolean = up.rewriteOrigin ?? true;

            for( const prefix of up.prefixes )
            {
                // the route table owns /api in LOCAL mode — don't also register a prefix proxy on it
                if( hasRouteTable && ( prefix === "/api" || prefix.startsWith( "/api/" ) ) ) continue;

                this.log.info( "proxy upstream", { prefix, target: up.target } );
                this.server.register( fastifyHttpProxy, {
                    upstream      : up.target,
                    prefix,
                    rewritePrefix : prefix,
                    http2         : false,
                    replyOptions  : {
                        rewriteRequestHeaders : ( _req, headers ) => (
                            rewriteOrigin ? { ...headers, origin: up.target } : headers
                        ),
                    },
                } );
            }
        }
    }

    /////////////////////////////////////////////////////////////////////////////////////////
    /** Turn an upstream's HTTP(S) target + ws path into the backend WS URL parts. */
    private resolveWsRoute( up : ProxyService.Upstream ) : ProxyService.WsRoute
    {
        const url : URL = new URL( up.target );
        return {
            origin   : up.target,
            wsBase   : ( url.protocol === "https:" ? "wss://" : "ws://" ) + url.host,
            wsPath   : up.ws ?? "",
        };
    }

    /////////////////////////////////////////////////////////////////////////////////////////
    /** SPA fallback: any unmatched GET returns index.html so client-side routing works. */
    private registerSpaFallback() : void
    {
        if( !this.server || !this.cfg.web.spaFallback ) return;

        const indexPath : string = path.join( this.resolveWebRoot(), this.cfg.web.index );
        this.server.setNotFoundHandler( async ( request : FastifyRequest, reply : FastifyReply ) : Promise<void> =>
        {
            // never fall back for asset requests or non-GETs — those are real 404s.
            // also a real 404 if the SPA shell isn't built yet (web root has no index.html).
            if( request.method !== "GET" || request.url.startsWith( "/assets/" ) || !fs.existsSync( indexPath ) )
            {
                // DIAGNOSTIC: a request reached the SPA not-found handler — if this fires for an /api path,
                // the route table / upstream prefix did NOT claim it (e.g. routes empty + /api prefix skipped).
                this.log.warn( "proxy 404 (not-found handler)", { method: request.method, url: request.url } );
                reply.status( 404 ).send( { error: "Not Found" } );
                return;
            }
            // no-store: the SPA shell must always revalidate so a rebuild's new asset refs load on refresh
            reply.header( "Cache-Control", "no-store, must-revalidate" ).type( "text/html" ).send( fs.readFileSync( indexPath ) );
        } );
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Extra routes (liveness + optional Zendesk article passthrough)
    // ──────────────────────────────────────────────────────────────────────────

    /////////////////////////////////////////////////////////////////////////////////////////
    private registerExtraRoutes() : void
    {
        if( !this.server ) return;

        this.server.get( "/ping", async ( _req : FastifyRequest, reply : FastifyReply ) : Promise<void> =>
        {
            reply.code( 200 ).send( "pong" );
        } );

        // Zendesk help-center article proxy — only if configured. The API token is read from the
        // env var named by `zendesk.tokenEnv` (never hard-coded / committed).
        if( this.cfg.zendesk ) this.registerZendeskArticle( this.cfg.zendesk );
    }

    /////////////////////////////////////////////////////////////////////////////////////////
    private registerZendeskArticle( zd : ProxyService.ZendeskConfig ) : void
    {
        if( !this.server ) return;

        this.server.get( "/article", async ( request : FastifyRequest, reply : FastifyReply ) : Promise<void> =>
        {
            const id : string | undefined = ( request.query as { id? : string } ).id;
            const token : string = process.env[ zd.tokenEnv ] ?? "";
            if( !id || !token )
            {
                reply.code( 400 ).send( { error: "missing id or Zendesk token" } );
                return;
            }

            // Zendesk token auth: base64("{email}/token:{api_token}")
            const auth : string = Buffer.from( `${zd.email}/token:${token}` ).toString( "base64" );
            const client : AxiosInstance = axios.create( {
                baseURL : zd.baseUrl,
                headers : { "Content-Type": "application/json", Authorization: `Basic ${auth}` },
            } );

            try
            {
                const response : AxiosResponse = await client.get( `/api/v2/help_center/articles/${id}` );
                reply.code( 200 ).send( response.data );
            }
            catch( err : unknown )
            {
                this.log.error( "proxy /article failed", { id, err } );
                reply.code( 404 ).send( { error: "Not Found" } );
            }
        } );
    }

    // ──────────────────────────────────────────────────────────────────────────
    // WebSocket proxy — bridge a client socket to the upstream's WS endpoint
    // ──────────────────────────────────────────────────────────────────────────

    /////////////////////////////////////////////////////////////////////////////////////////
    /** Hook the raw HTTP server's `upgrade` event to our noServer WSS for the configured ws path. */
    private registerWebSocketUpgrade() : void
    {
        if( !this.server ) return;

        this.wss.on( "connection", ( client : WebSocket, request : IncomingMessage ) => this.onClientSocket( client, request ) );

        this.server.server.on( "upgrade", ( request : IncomingMessage, socket : Stream.Duplex, head : Buffer ) =>
        {
            const route : ProxyService.WsRoute | undefined = this.wsRoute;
            const reqPath : string = ( request.url ?? "" ).split( "?" )[ 0 ];

            if( route && reqPath === route.wsPath )
            {
                this.wss.handleUpgrade( request, socket, head, ( client : WebSocket ) =>
                    this.wss.emit( "connection", client, request ) );
            }
            else
            {
                socket.destroy();
            }
        } );
    }

    /////////////////////////////////////////////////////////////////////////////////////////
    /** Pipe one accepted client socket bidirectionally to a fresh upstream backend socket. */
    private onClientSocket( client : WebSocket, request : IncomingMessage ) : void
    {
        const route : ProxyService.WsRoute | undefined = this.wsRoute;
        if( !route || !request.url ) { client.close(); return; }

        // carry through the cid query param + auth/cookie headers, force the upstream's origin.
        const accountId : string = new URL( request.url, "http://localhost" ).searchParams.get( "accountId" ) ?? "";
        const backendUrl : string = `${route.wsBase}${route.wsPath}?accountId=${accountId}`;

        const headers : Record<string, string> = { origin: route.origin };
        if( request.headers.cookie )        headers[ "cookie" ]        = request.headers.cookie;
        if( request.headers.authorization ) headers[ "authorization" ] = request.headers.authorization;

        const backend : WebSocket = new WebSocket( backendUrl, { headers } );

        backend.on( "message", ( data : WebSocket.RawData ) => { if( client.readyState === WebSocket.OPEN ) client.send( data ); } );
        client.on(  "message", ( data : WebSocket.RawData ) => { if( backend.readyState === WebSocket.OPEN ) backend.send( data ); } );

        backend.on( "close", () => client.close() );
        backend.on( "error", () => client.close() );
        client.on(  "close", () => backend.close() );
        client.on(  "error", () => backend.close() );
    }

    // ──────────────────────────────────────────────────────────────────────────

    /////////////////////////////////////////////////////////////////////////////////////////
    /** Base hook: close the WSS so in-flight upgrades drain on shutdown. */
    protected override async aboutToQuit() : Promise<void>
    {
        this.wss.close();
    }
}

export namespace ProxyService
{
    /** Proxy configuration (one file per environment under ./config). */
    export interface Config extends Application.Config
    {
        web       : WebConfig;
        upstreams : Array<Upstream>;
        routes?   : Array<Route>;       // LOCAL: per-endpoint → role-service dispatch (mounted on /api)
        zendesk?  : ZendeskConfig;
    }

    /** One generated route in the LOCAL per-endpoint table: method + path (with :params) → role target. */
    export interface Route
    {
        method : string;        // GET / POST / …
        path   : string;        // e.g. "/api/auth/v1/login" (may contain :params)
        target : string;        // role-service base URL, e.g. "http://localhost:8111"
    }

    /** The built web app (apps/core/web) to serve as static files + SPA fallback. */
    export interface WebConfig
    {
        root        : string;       // dir with index.html + assets; relative paths resolve from this module (or PROXY_WEB_ROOT)
        index       : string;       // e.g. "index.html"
        prefix      : string;       // mount prefix, e.g. "/"
        spaFallback : boolean;      // serve index.html for unmatched GETs (client-side routing)
    }

    /** An upstream the proxy forwards to — LOCAL / LocalStack / a deployed AWS env. */
    export interface Upstream
    {
        name?          : string;        // label for logs
        target         : string;        // base URL, e.g. "http://localhost:8000" | "https://app.rumbleup.com"
        prefixes       : Array<string>; // path prefixes to forward (e.g. "/auth", "/account")
        ws?            : string;        // websocket path to bridge (e.g. "/account/ws")
        rewriteOrigin? : boolean;       // rewrite the Origin header to `target` (default true)
    }

    /** Optional Zendesk help-center article passthrough. */
    export interface ZendeskConfig
    {
        baseUrl  : string;          // e.g. "https://rumbleup.zendesk.com"
        email    : string;          // token-auth email
        tokenEnv : string;          // NAME of the env var holding the API token (never the token itself)
    }

    /** Resolved upstream WebSocket target (derived from an Upstream's target + ws path). */
    export interface WsRoute
    {
        origin : string;            // Origin header forced on the backend connection
        wsBase : string;            // "ws(s)://host"
        wsPath : string;            // the path to connect to upstream
    }
}

export default ProxyService;
