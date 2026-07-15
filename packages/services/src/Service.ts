//
// Service — the request-driven Daemon: a long-running Fastify HTTP server (the "serves" role).
// It blocks on an HTTP listener and reacts to inbound requests. The long-running lifecycle
// (OS signals, graceful drain, fatal-boot, process.exit) lives on `Daemon`; Service adds only
// the HTTP server + routing.
//
import fastify          from 'fastify';
import formbody         from '@fastify/formbody';
import { FastifyInstance, FastifyReply, FastifyRequest, FastifyError, FastifyListenOptions, HTTPMethods } from 'fastify';

import { randomUUID } from 'crypto';

import { RestfulEndpoint, Access } from '@repo/endpoint';
import { NetworkUtils } from '@repo/common';

import { Daemon } from './Daemon';
import { RequestContext } from './RequestContext';
import type { Register } from '@repo/system';
import { Authorizer } from './Authorizer';
import { GetHealthImpl } from './endpoints/GetHealthImpl';
import { GetVersionImpl } from './endpoints/GetVersionImpl';
import { fastifyLogger } from './FastifyLog';



export class Service extends Daemon
{
    protected server    : FastifyInstance | null;
    private log_server  : boolean;
    private port        : number = 8000;
    private host        : string = 'localhost';
    public version      : string = "unset";
    private _authorizer? : Authorizer;   // shared authz-store reader (lazy) — see resolveRole

    /////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    /**
     * @param service the canonical service id (`Register.Service.*`).
     * @param role    optional role distinguishing instances (`main`/`public`, `reader`/`writer`) → name `service:role`.
     * @param port    default local-dev port (from `Ports.*`); a deploy's env `PORT` always overrides it.
     */
    constructor( service : Register.Service, role ? : string, port ? : number )
    {
        super( service, role );
        this.server     = null;

        // Port precedence: env PORT (a deploy/container injects it — it MUST win) → the
        // service's own default (`port`) → 8000. A non-numeric env PORT falls through to the default.
        const env_port  : number = parseInt( process.env.PORT ?? "" );
        this.port       = Number.isNaN( env_port ) ? ( port ?? 8000 ) : env_port;

        this.host       = process.env.HOST ?? '0.0.0.0';            // inside container host
        this.log_server = true;
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////////////////
    protected setVersion( version : string ) : void
    {
        this.version = version;
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////////////////
    /** Canonical service id (e.g. "app"), without any role qualifier — for the public /version reply. */
    public name() : string
    {
        return String( this.service );
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////////////////
    protected bindCallbacks() : void
    {
        // Daemon binds the OS-signal handler; Service adds its Fastify error handler.
        super.bindCallbacks();

        this.processError = this.processError.bind( this );
    }

    /////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    protected register( endpt : RestfulEndpoint ) : void
    {
        if( this.server )
        {
            this.log.info('register', endpt.method, endpt.uri );
            this.server.route( { method     : endpt.method as HTTPMethods,
                                 url        : endpt.uri,
                                 handler    : async ( request: FastifyRequest, reply: FastifyReply ) => this.processEndpoint( request, reply, endpt ) } );
        }
    }

    /////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    private async processEndpoint( request: FastifyRequest, reply: FastifyReply, endpt : RestfulEndpoint ) : Promise<void>
    {
        // one transaction id per request: reuse the caller's `x-transactionid` (API Gateway / client / S2S)
        // else mint one. Echo it back so the caller can correlate, and carry it in RequestContext so every log
        // line + downstream call/event this request makes is stamped with it (console trace / CloudWatch / X-Ray).
        const transactionId : string = String( ( request.headers as Record<string, unknown> )[ RestfulEndpoint.RestfulHeaders.TRANSACTION_ID ] ?? "" ) || randomUUID();
        reply.header( RestfulEndpoint.RestfulHeaders.TRANSACTION_ID, transactionId );

        await RequestContext.run( { transactionId }, async () : Promise<void> =>
        {
        try
        {
            // Endpoint instances are registered ONCE and shared across every request to their route. Their
            // query/body/headers are MUTABLE instance state (set by unmarshalServer), so concurrent requests
            // to the same route race — one request's execute() reads another's params (e.g. the media grid
            // firing 8 GET /assets/:guid/url at once all resolving to the last guid). Work on a per-request
            // SHALLOW CLONE: its own mutable state, sharing the prototype methods + the (stateless) service ref.
            const scoped : RestfulEndpoint = Object.assign( Object.create( Object.getPrototypeOf( endpt ) ) as RestfulEndpoint, endpt );
            scoped.reset();

            //
            // Hydrate the endpoint from the incoming request and validate it against its schemas.
            // unmarshalServer throws on a validation failure, which we map to BAD_REQUEST below.
            //
            try
            {
                scoped.unmarshalServer( { headers  : request.headers,
                                          query    : request.query,
                                          fullPath : request.url,
                                          body     : request.body } );
            }
            catch( err : any )
            {
                reply.code( NetworkUtils.Status.BAD_REQUEST ).send( { message: String( err?.message ?? err ) } );
                return;
            }

            // Resolve the caller from the bearer access token (best-effort, dev): decode the JWT
            // payload and lift sub/username + claims. NOTE: this does NOT verify the signature — in
            // production the API Gateway Lambda authorizer validates the token (JWKS) and forwards the
            // claims; this local path keeps auth working against Cognito on LocalStack.
            const authenticate : RestfulEndpoint.Authentication = Service.authFromRequest( request );
            authenticate.transactionId = transactionId;   // acting context carries the request's correlation id

            // Developer API key bearer (`rup_<keyId>.<secret>`) — not a JWT, so authFromRequest leaves it as a
            // bare token with no userId. Verify it against the auth-owned key store (a shared authz read, like
            // the membership read) and ADOPT the key's owner/account/role. Fails closed: an invalid key stays
            // unauthenticated and the authorize gate below rejects it.
            //
            // SCOPE: dev keys are the PUBLIC developer-API credential ONLY. They must never authenticate a
            // first-party (APP) or internal (INTERNAL) endpoint — those are session-JWT / S2S surfaces not in
            // the published docs. So a key is accepted only on a PUBLIC-audience endpoint; presented anywhere
            // else it's rejected outright (403), even if the key itself is valid.
            if( !authenticate.userId && authenticate.token && authenticate.token.startsWith( "rup_" ) )
            {
                const identity : Authorizer.ApiKeyIdentity | undefined = await ( this._authorizer ??= new Authorizer( this.cloud ) ).verifyApiKey( authenticate.token );
                if( identity )
                {
                    if( scoped.audience !== RestfulEndpoint.Audience.PUBLIC )
                    {
                        reply.code( NetworkUtils.Status.FORBIDDEN ).send( { message: "API keys can only be used with the public API" } );
                        return;
                    }
                    authenticate.userId    = identity.userId;
                    authenticate.accountId = identity.accountId;
                    authenticate.role      = identity.role;
                    authenticate.apiKey    = true;   // role is adopted from the key — skip membership re-resolution
                }
            }

            // Authorize: an endpoint that declares a minimum role (endpt.access) requires (1) a signed-in
            // caller and (2) a role that meets the minimum on the Access ladder. The JWT is IDENTITY-ONLY —
            // the caller's role is resolved PER REQUEST via resolveRole() (a service that owns membership
            // reads it from DynamoDB; the base falls back to claims, default USER). The resolved role +
            // account are written back onto `authenticate` so execute() sees the acting context.
            if( scoped.access !== undefined )
            {
                if( !authenticate.userId )
                {
                    reply.code( NetworkUtils.Status.UNAUTHORIZED ).send( { message: "authentication required" } );
                    return;
                }
                // an API-key caller already carries its adopted role (capped at mint) — trust it, don't re-resolve
                const callerRole : Access.Role = authenticate.apiKey && authenticate.role
                    ? ( authenticate.role as Access.Role )
                    : await this.resolveRole( authenticate );
                authenticate.role = callerRole;
                if( !Access.isAllowed( callerRole, scoped.access ) )
                {
                    reply.code( NetworkUtils.Status.FORBIDDEN ).send( { message: "insufficient role" } );
                    return;
                }
            }

            //
            // have the endpoint execute the request
            //
            const response : RestfulEndpoint.Response = await scoped.execute( authenticate );

            //
            // reply to client
            //
            reply.header( NetworkUtils.HeaderType.CONTENT, NetworkUtils.MimeType.JSON )
                 .code( response.status )
                 .send( response.data );
        }
        catch( err : any )
        {
            this.log.error( "processEndpoint:exception", err );
            reply.code( NetworkUtils.Status.INTERNAL_SERVER_ERROR ).send('server exception');
        }
        } );
    }

    /////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    /**
     * Resolve the caller from the request's `Authorization: Bearer <jwt>` header. DEV path: decodes the
     * JWT payload (base64url) WITHOUT verifying the signature and lifts `sub`/username + claims, so
     * "current user" endpoints work against Cognito-issued tokens locally. PROD: the API Gateway Lambda
     * authorizer verifies the token (JWKS) and this becomes a trusted read of forwarded claims.
     */
    private static authFromRequest( request : FastifyRequest ) : RestfulEndpoint.Authentication
    {
        const header : string = String( ( request.headers as Record<string, unknown> )[ "authorization" ] ?? "" );
        const match  : RegExpMatchArray | null = header.match( /^Bearer\s+(.+)$/i );
        if( !match ) return {};

        const token : string = match[ 1 ].trim();
        const parts : Array<string> = token.split( "." );
        if( parts.length < 2 ) return { token };

        try
        {
            const claims : Record<string, unknown> = JSON.parse( Buffer.from( parts[ 1 ], "base64url" ).toString( "utf-8" ) );
            const userId : string | undefined = ( claims.sub as string ) ?? undefined;
            const username : string | undefined = ( claims[ "cognito:username" ] as string ) ?? ( claims.username as string ) ?? userId;
            // the client states which account it's ACTING in via the X-Account header (identity-only token);
            // the role is then resolved for (userId, accountId) — see resolveRole.
            const accountId : string | undefined = ( ( request.headers as Record<string, unknown> )[ "x-account" ] as string ) || undefined;
            return { userId, username, token, claims, accountId };
        }
        catch
        {
            return { token };
        }
    }

    /////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    /**
     * Resolve the caller's role from JWT claims — a `role` claim, else the first `cognito:groups` entry —
     * mapped to a known Access ladder role. Returns `undefined` when there's no recognizable role claim
     * (the caller is then treated as the default authenticated role by the authorizer above).
     */
    private static roleFromClaims( claims? : Record<string, unknown> ) : Access.Role | undefined
    {
        if( !claims ) return undefined;

        const groups : unknown = claims[ "cognito:groups" ];
        const candidate : string | undefined =
              typeof claims[ "role" ] === "string" ? ( claims[ "role" ] as string )
            : Array.isArray( groups ) && typeof groups[ 0 ] === "string" ? ( groups[ 0 ] as string )
            : undefined;

        if( !candidate ) return undefined;
        return ( Access.LADDER as ReadonlyArray<string> ).includes( candidate ) ? ( candidate as Access.Role ) : undefined;
    }

    /////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    /**
     * Resolve the caller's effective role for THIS request (the JWT is identity-only — the role is NOT a
     * token claim). Resolution order:
     *   1. a forwarded `role` claim — PROD: the API-Gateway authorizer verified the token AND resolved the
     *      role from DynamoDB, forwarding it in the request context; trust it.
     *   2. DEV (no authorizer): the shared {@link Authorizer} resolves the role for the ACTING account
     *      (X-Account header) from the authz store — the same read the prod Lambda authorizer performs.
     *   3. otherwise the default authenticated role (USER).
     * The authz read lives in ONE shared component (not duplicated/ad-hoc per service). Failures fall
     * through to USER (never crash a request over an authz lookup).
     */
    protected async resolveRole( auth : RestfulEndpoint.Authentication ) : Promise<Access.Role>
    {
        const claimed : Access.Role | undefined = Service.roleFromClaims( auth.claims );
        if( claimed ) return claimed;

        if( auth.userId && auth.accountId )
        {
            const role : Access.Role | undefined = await ( this._authorizer ??= new Authorizer( this.cloud ) ).roleFor( auth.userId, auth.accountId );
            if( role ) return role;
        }
        return Access.AccountRole.USER;
    }

    /////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    protected get( uri : string, callback : Service.RequestCallbackAsync ) : void
    {
        if( this.server )this.server.get( uri, async ( request: FastifyRequest, reply: FastifyReply ) => this.processRequestAsync( request, reply, callback ) );
    }
    /////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    protected put( uri : string, callback : Service.RequestCallbackAsync ) : void
    {
        if( this.server )this.server.put( uri, async ( request: FastifyRequest, reply: FastifyReply ) => this.processRequestAsync( request, reply, callback ) );
    }
    /////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    protected delete( uri : string, callback : Service.RequestCallbackAsync ) : void
    {
        if( this.server )this.server.delete( uri, async ( request: FastifyRequest, reply: FastifyReply ) => this.processRequestAsync( request, reply, callback ) );
    }
    /////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    protected post( uri : string, callback : Service.RequestCallbackAsync ) : void
    {
        if( this.server )this.server.post( uri, async ( request: FastifyRequest, reply: FastifyReply ) => this.processRequestAsync( request, reply, callback ) );
    }
    /////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    protected head( uri : string, callback : Service.RequestCallbackAsync ) : void
    {
        if( this.server )this.server.head( uri, async ( request: FastifyRequest, reply: FastifyReply ) => this.processRequestAsync( request, reply, callback ) );
    }
    /////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    protected patch( uri : string, callback : Service.RequestCallbackAsync ) : void
    {
        if( this.server )this.server.patch( uri, async ( request: FastifyRequest, reply: FastifyReply ) => this.processRequestAsync( request, reply, callback ) );
    }
    /////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    protected options( uri : string, callback : Service.RequestCallbackAsync ) : void
    {
        if( this.server )this.server.options( uri, async ( request: FastifyRequest, reply: FastifyReply ) => this.processRequestAsync( request, reply, callback ) );
    }

    /////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    private async processRequestAsync( request: FastifyRequest, reply: FastifyReply, callback : Service.RequestCallbackAsync ) : Promise<void>
    {
        try
        {
            const start : number = Date.now();

            // all requests will have a transactionid, otherwise create one
            let transaction_id : string = request.headers[ RestfulEndpoint.RestfulHeaders.TRANSACTION_ID ] as string ?? randomUUID();

            // execute the callback that will fullfill the request
            let got   : RestfulEndpoint.Response = await callback( request );

            // keep track of some stats about the request
            let stats : RestfulEndpoint.Stats = { duration: Date.now() - start };

            // log request here
            // todo

            // todo: make const enum reference for content types
            reply.header( NetworkUtils.HeaderType.CONTENT, NetworkUtils.MimeType.JSON )
                 .header( RestfulEndpoint.RestfulHeaders.TRANSACTION_ID, transaction_id )      // always give it back
                 .header( RestfulEndpoint.RestfulHeaders.STATS, JSON.stringify( stats ) )      // always give it back
                 .code( got.status )
                 .send( got.data );
        }
        catch( err: any )
        {
            this.log.error( "Service::processRequestAsync: exception", err );
            reply.code( NetworkUtils.Status.INTERNAL_SERVER_ERROR ).send('Service::processRequestAsync exception');
        }
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////////////////
    protected async registerEndpoints() : Promise<void>
    {
        this.register( new GetHealthImpl( this ) );
        this.register( new GetVersionImpl( this ) );
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////////////////
    // call in case inherited classes want to register with Fastify other capacilities
    protected addServerRegister() : void
    {
        if( this.server )this.server.register( formbody );
    }

    /////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    private processError( error: FastifyError, request: FastifyRequest, reply: FastifyReply ) : void
    {
        this.log.error( "processError", { error: error, url: request.url, method: request.method } );
        reply.status( NetworkUtils.Status.INTERNAL_SERVER_ERROR ).send( error );
        //this.stop( 1 );
    }


    ///////////////////////////////////////////////////////////////////////////////////////////////////////////////
    // start() is the Application lifecycle's final boot step. For a Service it stands up Fastify and
    // begins listening; the open socket keeps the process alive (the Daemon owns signals/shutdown).
    protected async start() : Promise<void>
    {
        this.log.info("startServer", { port : this.port, host: this.host } );

        // Route Fastify's own logs through our Trace (one record format) via `loggerInstance` rather
        // than letting it spin up its own Pino → stdout. When log_server is off, disable logging.
        // https://fastify.dev/docs/latest/Reference/Server/#logger
        const routerOptions = {
            ignoreTrailingSlash     : true,
            ignoreDuplicateSlashes  : true,
            caseSensitive           : false,
            maxParamLength          : 100
        };

        this.server = this.log_server
            ? fastify({ loggerInstance: fastifyLogger( this.log ), disableRequestLogging: true, routerOptions })
            : fastify({ logger: false, disableRequestLogging: true, routerOptions });

        this.server.setErrorHandler( this.processError );

        this.addServerRegister();
        this.registerEndpoints();

        try
        {
            let opts : FastifyListenOptions = { port: this.port, host: this.host };
            const address : string = await this.server.listen( opts );

            this.log.info("serviceStarted", { address : address, cpus : this.nbr_cpus } );
            this.serviceReady();
        }
        catch( err : any )
        {
            this.log.error( "startServer exception", err );
            process.exit( 1 );
        }

    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////////////////
    // to override by actual service to do something
    protected serviceReady() : void
    {
        // Announce WHICH process this is — service, version, pid, port. The log line's own timestamp is the
        // start time, so a glance answers "am I running current code, or a stale/orphan process?" (services run
        // under plain `tsx`, no hot-reload, so a code change needs a real restart).
        this.log.info( "ServiceReady", { service: this.name(), version: this.version, pid: process.pid, port: this.port } );
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////////////////
    // gracefully close the HTTP server (stop accepting + drain in-flight) before the Daemon exits.
    protected async aboutToQuit() : Promise<void>
    {
        if( this.server )
        {
            try { await this.server.close(); }
            catch( err : any ) { this.log.error( "Service::aboutToQuit server.close failed", err ); }
        }
        await super.aboutToQuit();
    }

}

export namespace Service
{
    //export interface RequestCallback{ ( request: FastifyRequest ) : RestfulEndpoint.Response }
    export interface RequestCallbackAsync{ ( request: FastifyRequest ) : Promise<RestfulEndpoint.Response> }
}

export default Service;
