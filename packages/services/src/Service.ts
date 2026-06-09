//
import * as os from 'os';

import fastify          from 'fastify';
import fastifyStatic    from '@fastify/static';
import proxy            from '@fastify/http-proxy';
import formbody         from '@fastify/formbody';
import { FastifyInstance, FastifyReply, FastifyRequest, FastifyError, FastifyListenOptions, HTTPMethods } from 'fastify';

import { randomUUID } from 'crypto';

import { RestfulEndpoint } from '@repo/endpoint';
import { NetworkUtils } from '@repo/common';

import { Application } from './Application';
import { GetHealthImpl } from './endpoints/GetHealthImpl';



export class Service extends Application
{
    protected server    : FastifyInstance | null;
    private log_server  : boolean;
    private port        : number = 8000;
    private host        : string = 'localhost';
    private shuttingDown : boolean = false;

    // max time to wait for aboutToQuit() before forcing the process to exit
    private static readonly SHUTDOWN_TIMEOUT_MS : number = 10_000;

    ////////////////////////////////////////////////////////////////////////
    constructor( name : string, port ? : number )
    {
        super( name );
        this.server     = null;
        this.port       = port ?? parseInt( process.env.PORT ?? "8000" );
        this.host       = process.env.HOST ?? '0.0.0.0';            // inside container host
        this.log_server = true;
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////////////////
    protected bindCallbacks() : void
    {
        super.bindCallbacks();

        this.onSignalShutdown   = this.onSignalShutdown.bind( this );
        this.processError       = this.processError.bind( this );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    protected async init() : Promise<void>
    {
        await super.init();

        // a long-running service owns its process lifecycle, so it listens for OS shutdown signals
        this.registerSignals();

        //this.get( "/health", this.getHealth );


    }

    ////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    private registerSignals() : void
    {
        process.on( 'SIGINT', this.onSignalShutdown );
        process.on( 'SIGTERM', this.onSignalShutdown );
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////////////////
    private onSignalShutdown() : void
    {
        // ignore repeated signals (e.g. double Ctrl-C) so shutdown only runs once
        if( this.shuttingDown )
        {
            this.log.warn('Service::onSignalShutdown ignored - shutdown already in progress');
            return;
        }
        this.shuttingDown = true;

        this.log.info('Service::onSignalShutdown (SIGINT or SIGTERM)');

        // safety net: if aboutToQuit() hangs, force the process to exit
        const force = setTimeout( () => {
            this.log.error('Service::onSignalShutdown timed out - forcing exit');
            process.exit( 1 );
        }, Service.SHUTDOWN_TIMEOUT_MS );
        force.unref();

        this.doShutdown();
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////////////////
    private async doShutdown() : Promise<void>
    {
        try
        {
            await this.aboutToQuit();
            this.stop( 0 );
        }
        catch( err : any )
        {
            this.log.error("Error during shutdown", err );
            this.stop( 1 );
        }
    }

    /////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    private stop( code : number ) : void
    {
        this.log.info( "Service shutting down", { code: code } );
        process.exit( code );
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
    protected async start() : Promise<void>
    {
        this.log.info("startServer", { port : this.port, host: this.host } );

        //this.serviceAboutToStart();

        // https://fastify.dev/docs/latest/Reference/Server/#logger
        this.server = fastify({ logger                  : this.log_server,
                                disableRequestLogging   : true,
                                routerOptions           : {
                                                            ignoreTrailingSlash     : true,
                                                            ignoreDuplicateSlashes  : true,
                                                            caseSensitive           : false,
                                                            maxParamLength          : 100
                                                        }
                                });
        
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
    // A long-running service cannot continue without a successful boot, so a failed run()
    // is fatal: log and exit non-zero. (process.exit lives here, not in Application.)
    public async run() : Promise<void>
    {
        try
        {
            await super.run();
        }
        catch( err : any )
        {
            this.log.error( "Service::run boot failed - exiting", { code: 1 } );
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
    // allow inherited servies to perform clean up on exit
    // like cleaning up database connections
    protected async aboutToQuit() : Promise<void>
    {
    }

}

export namespace Service
{
    //export interface RequestCallback{ ( request: FastifyRequest ) : RestfulEndpoint.Response }
    export interface RequestCallbackAsync{ ( request: FastifyRequest ) : Promise<RestfulEndpoint.Response> }
}

export default Service;