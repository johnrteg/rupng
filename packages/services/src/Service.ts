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

import { RestfulEndpoint } from '@repo/endpoint';
import { NetworkUtils } from '@repo/common';

import { Daemon } from './Daemon';
import type { Register } from '@repo/system';
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
        try
        {
            // endpoint instances are registered once and reused, so clear per-request state first
            endpt.reset();

            //
            // Hydrate the endpoint from the incoming request and validate it against its schemas.
            // unmarshalServer throws on a validation failure, which we map to BAD_REQUEST below.
            //
            try
            {
                endpt.unmarshalServer( { headers  : request.headers,
                                         query    : request.query,
                                         fullPath : request.url,
                                         body     : request.body } );
            }
            catch( err : any )
            {
                reply.code( NetworkUtils.Status.BAD_REQUEST ).send( { message: String( err?.message ?? err ) } );
                return;
            }

            let authenticate : RestfulEndpoint.Authentication = {};

            // authentication required
            if( endpt.access !== undefined )
            {
                // todo

                // get information from request to authenticate

                // verify who is asking has access to this endpoint (role)

                // if not, return error
                // NetworkUtils.Status.UNAUTHORIZED
            }

            //
            // have the endpoint execute the request
            //
            const response : RestfulEndpoint.Response = await endpt.execute( authenticate );

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
        this.log.info( "ServiceReady" );
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
