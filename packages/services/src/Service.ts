//
import * as os from 'os';

import fastify          from 'fastify';
import fastifyStatic    from '@fastify/static';
import proxy            from '@fastify/http-proxy';
import formbody         from '@fastify/formbody';
import { FastifyInstance, FastifyReply, FastifyRequest, FastifyError, FastifyListenOptions, HTTPMethods } from 'fastify';

import { randomUUID } from 'crypto';

import { Endpoint, UserAgent } from '@repo/endpoint';
import { Network } from '@repo/common';

import { Application } from './Application';
import { GetHealthImpl } from './endpoints/GetHealthImpl';



export class Service extends Application
{
    protected server    : FastifyInstance | null;
    private log_server  : boolean;
    private port        : number = 8000;
    private host        : string = 'localhost';

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

        this.processError       = this.processError.bind( this );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    protected async init() : Promise<void>
    {
        super.init();

        //this.get( "/health", this.getHealth );

        
    }

    /////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    protected register( endpt : Endpoint ) : void
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
    private async processEndpoint( request: FastifyRequest, reply: FastifyReply, endpt : Endpoint ) : Promise<void>
    {
        try
        {
            endpt.reset();

            // determine identify of the request, if any
            //
            // allow the endpoint to parse the request to attributes unique to the endpoint
            //

            // parse off needed information
            // endpoint does not need all of FastifyRequest (maybe file blob?)

            // strip any parameters from url
            let url : string = request.url;
            let query : any = {};
            if( url.indexOf('?') > 0 )url = url.substring( 0, url.indexOf('?') );
            if( request.query )query = JSON.parse( JSON.stringify( request.query ) );   // copy object

            // parse off architecture specific headers
            // todo

            // set the request
            let client_request : Endpoint.ClientRequest = { host : request.host,
                                                            uri : url,
                                                            body : request.body,
                                                            query : query,
                                                            userAgent : UserAgent.parse(request.headers['user-agent'] ) };

            const check : Endpoint.Response = endpt.validate( client_request );
            if( check.status !== Network.Status.OK )
            {
                reply.code( check.status ).send( check.data );
            }
            else
            {
                let authenticate : Endpoint.Authentication = {};
                

                // authentication required
                if( endpt.access !== undefined )
                {
                    // todo
                    
                    // get information from request to authenticate

                    // verify who is asking has access to this endpoint (role)

                    // if not, return error
                    // Network.Status.UNAUTHORIZED
                }

                //
                // have the endpoint execute the request
                //
                const response : Endpoint.Response = await endpt.execute( authenticate );

                //
                // reply to client
                //
                reply.header('Content-Type', Network.MimeType.JSON )
                         //.header( Endpoint.Headers.TRANSACTION_ID, transaction_id )      // always give it back
                         .code( response.status )
                         .send( response.data );
            }
        }
        catch( err : any )
        {
            this.log.error( "processEndpoint:exception", err );
            reply.code( Network.Status.INTERNAL_SERVER_ERROR ).send('server exception');
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
            let transaction_id : string = request.headers[ Endpoint.Headers.TRANSACTION_ID ] as string ?? randomUUID();

            // execute the callback that will fullfill the request
            let got   : Endpoint.Response = await callback( request );

            // keep track of some stats about the request
            let stats : Endpoint.Stats = { duration: Date.now() - start };

            // log request here
            // todo

            // todo: make const enum reference for content types
            reply.header( Network.HeaderType.CONTENT, Network.MimeType.JSON )
                 .header( Endpoint.Headers.TRANSACTION_ID, transaction_id )      // always give it back
                 .header( Endpoint.Headers.STATS, JSON.stringify( stats ) )      // always give it back
                 .code( got.status )
                 .send( got.data );
        }
        catch( err: any )
        {
            this.log.error( "Service::processRequestAsync: exception", err );
            reply.code( Network.Status.INTERNAL_SERVER_ERROR ).send('Service::processRequestAsync exception');
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
        reply.status( Network.Status.INTERNAL_SERVER_ERROR ).send( error );
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
    //export interface RequestCallback{ ( request: FastifyRequest ) : Endpoint.Response }  
    export interface RequestCallbackAsync{ ( request: FastifyRequest ) : Promise<Endpoint.Response> }  
}

export default Service;