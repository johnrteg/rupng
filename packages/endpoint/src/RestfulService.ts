
//
//
//
import axios, { AxiosError, HeadersDefaults, AxiosInstance, AxiosProgressEvent } from "axios";

import { NetworkUtils, DateUtils, StringUtils, ObjectUtils, ValueUtils } from '@repo/common';

import { RestfulEndpoint }  from './RestfulEndpoint';


//
//
//
interface EndpointCache
{
    endpoint    : RestfulEndpoint;
    last_access : number;               // ms from 1970
    lifespan    : number;               // minutes
    reply       : RestfulService.Reply;
}


//
//
//
export class RestfulService
{
    private base_url            : string;
    private default_headers     : any;
    private default_timeout     : number;

    private client              : AxiosInstance;

    private cache               : Array<EndpointCache>;

    private timer               : ReturnType<typeof setInterval> | null;
    private cookies             : any = {};

    private csrfTag              : string | null = null;
    private csrfTzTag            : string | null = null;

    private callback_monitor  : RestfulService.CallHandle | null;

    // optional 401 recovery hook: invoked once on an Unauthorized response; if it resolves true (e.g. the
    // caller refreshed the access token), the original request is retried once. Lets a session transparently
    // survive access-token expiry without every call having to handle it.
    private unauthorizedHandler : ( () => Promise<boolean> ) | null = null;

    //////////////////////////////////////////////////////////////////////////////////////////////////////////
    constructor( base_url       : string,
                default_headers : any = {},
                timeout         : number = 10 * DateUtils.Time.SECONDS_TO_MS,   // 10 seconds
                csrf_tag        : string | null = null,
                csrf_tz_tag     : string | null = null,
                monitor         : RestfulService.CallHandle | null = null )
    {
        this.base_url = base_url;

        this.callback_monitor = monitor;

        // csrf
        if( csrf_tag    != null && csrf_tag    != "" )this.csrfTag = csrf_tag.toLowerCase();      // future case insensitivity
        if( csrf_tz_tag != null && csrf_tz_tag != "" )this.csrfTzTag = csrf_tz_tag.toLowerCase();

        this.default_headers = { ...default_headers, ContentType: NetworkUtils.MimeType.JSON };
        //this.default_headers = default_headers;
        this.default_headers[ 'ContentType' ]= NetworkUtils.MimeType.JSON;
        //this.default_headers = default_headers;
        this.default_timeout = timeout;
        this.cache = [];
        this.client = axios.create( { baseURL: this.base_url, headers: this.default_headers } );
        this.client.defaults.withCredentials = true;
        this.timer = null;
        this.checkCache = this.checkCache.bind( this );
    }

    //////////////////////////////////////////////////////////////////////////////////////////////////////////
    public passHeaders( headers: any, names : Array<string> ) : void
    {
        let i : number;
        for( i=0; i < names.length; i++ )
        {
            if( headers[ names[i] ] )
            {
                this.setHeader( names[i], headers[ names[i] ] );
            }
        }
    }

    //////////////////////////////////////////////////////////////////////////////////////////////////////////
    /** Register the 401-recovery hook (see {@link unauthorizedHandler}). Pass null to clear. */
    public setUnauthorizedHandler( handler : ( () => Promise<boolean> ) | null ) : void
    {
        this.unauthorizedHandler = handler;
    }

    //////////////////////////////////////////////////////////////////////////////////////////////////////////
    public setHeader( name: string, value : string | number | boolean ) : void
    {
        this.default_headers[name] = value;
    }

    //////////////////////////////////////////////////////////////////////////////////////////////////////////
    public setCookie( name: string, value : string | number | boolean ) : void
    {
        this.cookies[name] = value;
        let cookie_str : Array<string> = [];
        let cookie_keys : Array<string> = Object.keys( this.cookies );
        cookie_keys.forEach( ( cname : string ) => { cookie_str.push( cname + '=' + this.cookies[cname] ) } );

        this.default_headers['Cookie'] = cookie_str.join(';') ;
    }

    //////////////////////////////////////////////////////////////////////////////////////////////////////////
    public deleteHeader( name: string ) : void
    {
        if( ValueUtils.notNull( this.default_headers[name] ) )
        {
            delete this.default_headers[name];
        }
    }

    //////////////////////////////////////////////////////////////////////////////////////////////////////////
    public static error( response  : RestfulService.Reply, default_err? : string ) : string
    {
        return ( response.error && response.error?.message ) ? response.error.message : default_err ? default_err : "Unknown";
    }

    //////////////////////////////////////////////////////////////////////////////////////////////////////////
    public clear() : void
    {
        this.cache = [];
        if( ValueUtils.notNull( this.timer ) )
        {
            clearInterval( this.timer as ReturnType<typeof setInterval> );
            this.timer = null;
        }
    }

    //////////////////////////////////////////////////////////////////////////////////////////////////////////
    public getHeaders() : HeadersDefaults
    {
        return this.default_headers;
    }

    //////////////////////////////////////////////////////////////////////////////////////////////////////////
    private compareEndpts( endpt1 : RestfulEndpoint, endpt2 : RestfulEndpoint ) : boolean
    {
        // same urll and method
        if( endpt1.uri == endpt2.uri && endpt1.method == endpt2.method )
        {
            // same class, so campare requests
            //console.log("compare Endpts", JSON.stringify( endpt1.request ), JSON.stringify( endpt2.request ) );
            //if( JSON.stringify( endpt1.request ) === JSON.stringify( endpt2.request ) )return true;
        }
        return false;
    }

    //////////////////////////////////////////////////////////////////////////////////////////////////////////
    private checkCache() : void
    {
        //console.log("checkCache", this.cache.length );
        
        const now : number = new Date().getTime();
        let i : number = 0;
        while( i < this.cache.length )
        {
            if( this.cache[i].last_access + ( this.cache[i].lifespan * DateUtils.Time.MINUTES_TO_MS ) < now )
            {
                this.cache.splice( i, 1 );
            }
            else
            {
                i++;
            }
        }

        // cache is empty, so stop checking it
        if( this.cache.length == 0 )
        {
            //console.log("checkCache stopped" );
            clearInterval( this.timer as ReturnType<typeof setInterval> );
            this.timer = null;
        }
    }

    //////////////////////////////////////////////////////////////////////////////////////////////////////////
    private findCache( endpt : RestfulEndpoint ) : EndpointCache | null
    {
        let i : number;
        for( i=0; i < this.cache.length; i++ )
        {
            if( this.compareEndpts( this.cache[i].endpoint, endpt ) )
            {
                // check if lifespan of cache has passed
                const now : number = new Date().getTime();
                if( this.cache[i].last_access + ( this.cache[i].lifespan * 1000*60 ) < now )
                {
                    console.log("cache died");
                    this.cache.splice( i, 1 );

                    // cache now empty, so stop checking it
                    if( this.cache.length == 0 )
                    {
                        clearInterval( this.timer as ReturnType<typeof setInterval> );
                        this.timer = null;
                    }
                    return null;
                }
                else
                {
                    return this.cache[i];
                }
            }
        }
        return null;
    }

    /////////////////////////////////////////////////////////////////////////////////////////////////////////
    public async head( url : string, parameters : any = null, data : any = {}, headers : any = {}, timeout: number | null = null ) : Promise<RestfulService.Reply>
    {
        return await this.request( NetworkUtils.Method.HEAD, url, parameters, data, headers, timeout );
    }
    /////////////////////////////////////////////////////////////////////////////////////////////////////////
    public async post( url : string, parameters : any = null, data : any = {}, headers : any = {}, timeout: number | null = null ) : Promise<RestfulService.Reply>
    {
        return await this.request( NetworkUtils.Method.POST, url, parameters, data, headers, timeout );
    }

    /////////////////////////////////////////////////////////////////////////////////////////////////////////
    public async form(  url         : string,
                        parameters  : any = null,
                        data        : any = {},
                        headers     : any = {},
                        timeout     : number | null = null,
                        onProgress? : RestfulService.ProgressCallback ) : Promise<RestfulService.Reply>
    {
        const formData : FormData = new FormData();

        const keys : Array<string> = Object.keys( data );
        keys.forEach( ( key : string ) =>
        {
            if( data[key] !== undefined )
            {
                formData.append( key, data[key] );
            }
        } );

        return await this.request( NetworkUtils.Method.POST, url, parameters, formData, headers, timeout, onProgress );
    }


    /////////////////////////////////////////////////////////////////////////////////////////////////////////
    public async get(   url         : string,
                        parameters  : any = null,
                        headers     : any = {},
                        timeout     : number | null = null,
                        options     : RestfulService.Options | null = null ) : Promise<RestfulService.Reply>
    {
    /*
        let get_url : string = url;
        let args : string = RestfulService.queryString( parameters );
        if( args.length > 0 )get_url += ( '?' + args );
        let endpt : Endpoint = new Endpoint( NetworkUtils.Method.GET, get_url, undefined, timeout );

        if( options != null && options.cache )
        {
            let cached : EndpointCache | null = this.findCache( endpt );
            if( cached != null )
            {
                cached.last_access = new Date().getTime();  // just update last accessed
                console.log( 'returned cached results', endpt.method, endpt.uri );
                return cached.reply;
            }
        }
*/
        let reply : RestfulService.Reply = await this.request( NetworkUtils.Method.GET, url, parameters, null, headers, timeout );

        // check and store response if good
        if( options
            && ValueUtils.notNull( options.cache )
            && options.cache === true
            && reply.ok )
        {
            //console.log( 'cache endpt results', endpt.url, endpt.method, reply.data );
            // create enpt container
            // todo: add parameters
            // ignores headers but that should be consistent for caching
            /*
            this.cache.push( {  endpoint: endpt,
                                last_access: new Date().getTime(),
                                reply: reply,
                                lifespan : options.lifespan ?? 15 } );
            */
            // first one added, start timer
            if( this.cache.length == 1 )
            {
                this.timer = setInterval( this.checkCache, 1000*60*5 );   // 5 minute timer
            }
        }
        return reply;
    }
    /////////////////////////////////////////////////////////////////////////////////////////////////////////
    public async put( url : string, parameters : any = null, data : any = {}, headers : any = {}, timeout: number | null = null ) : Promise<RestfulService.Reply>
    {
        return await this.request( NetworkUtils.Method.PUT, url, parameters, data, headers, timeout );
    }
    /////////////////////////////////////////////////////////////////////////////////////////////////////////
    public async delete( url : string, parameters : any = null, data : any = {}, headers : any = {}, timeout: number | null = null ) : Promise<RestfulService.Reply>
    {
        return await this.request( NetworkUtils.Method.DELETE, url, parameters, data, headers, timeout );
    }

    //////////////////////////////////////////////////////////////////////////////////////////////////////////
    /**
    * Send an encapsulated, shared RestfulEndpoint and get back a typed reply. The endpoint marshals
    * itself (method, URI, query, body, headers) so the same class the server fulfills and the /cloud
    * build maps to a gateway route also drives the request — no per-call URL/verb wiring. The reply's
    * `data` is typed as the endpoint's Response (declare its Response as the 3rd generic of
    * RestfulEndpoint to get it, e.g. `class GetBootstrap extends RestfulEndpoint<Q, B, GetBootstrap.Response>`;
    * otherwise it falls back to `any`). Sits alongside the traditional get/post/put/delete helpers.
    */
    public async fetch<R = any>( endpoint : RestfulEndpoint<any, any, R>, timeout : number | null = null ) : Promise<RestfulService.Reply<R>>
    {
        const transport : RestfulEndpoint.ClientTransport = endpoint.marshalClient();   // url already carries the query string
        return await this.request( endpoint.method, transport.url, null, transport.body ?? null, transport.headers, timeout ) as RestfulService.Reply<R>;
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////////////
    public static queryString( parameters : any ) : string
    {
        if( ValueUtils.isNull( parameters ) )return "";

        let params : Array<string> = [];
        //let name : string;

        const keys : Array<string> = Object.keys( parameters );
        keys.forEach( ( key : string, index : number ) => {
            if( parameters[key] != undefined )
            {
                params.push( StringUtils.format( "{0}={1}", key, parameters[key].toString() ) );
            }
            
        } );

        return params.join('&');
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////////////
    private static tzOffset(): number
    {
        return -new Date().getTimezoneOffset();
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////////////
    // Ambient transaction-id source (optional). On a SERVER, the runtime wires this to the current request's
    // RequestContext so an S2S call FORWARDS the caller's transaction id (one id across the whole chain). In the
    // BROWSER no provider is set, so each request mints its own. An explicit `x-transactionid` header still wins.
    private static contextProvider? : () => string | undefined;

    /** Install the ambient transaction-id source (the server runtime does this once). */
    public static setContextProvider( provider : () => string | undefined ) : void
    {
        RestfulService.contextProvider = provider;
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////////////
    /** Mint a per-request transaction id (`crypto.randomUUID` when available; a compact fallback otherwise).
     *  Sent as `x-transactionid` so a single call can be traced across services / logs / X-Ray. */
    private static newTransactionId() : string
    {
        const global : { crypto? : { randomUUID? : () => string } } = globalThis as unknown as { crypto? : { randomUUID? : () => string } };
        if( global.crypto?.randomUUID ) return global.crypto.randomUUID();
        return `txn-${ Date.now().toString( 36 ) }-${ Math.random().toString( 36 ).slice( 2, 10 ) }`;
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////////////
    private async request(  method      : NetworkUtils.Method,
                            url         : string,
                            parameters  : any | null = null,
                            data        : any | null = null,
                            headers     : any | null = null,
                            timeout     : number | null = null,
                            onProgress? : RestfulService.ProgressCallback,
                            isRetry     : boolean = false ) : Promise<RestfulService.Reply>
    {
        // a per-request transaction id for end-to-end tracing — sent as `x-transactionid` (the server echoes
        // it back + threads it through logs/monitor/X-Ray). Reuse a caller-supplied id if present, else mint one.
        // Surfaced on the Reply so a developer can grab it (also visible as the request/response header in devtools).
        const transactionId : string = ( headers?.[ RestfulEndpoint.RestfulHeaders.TRANSACTION_ID ] as string ) || RestfulService.contextProvider?.() || RestfulService.newTransactionId();

        let reply : RestfulService.Reply = { ok: true, duration: 0, status: NetworkUtils.Status.OK, transactionId };
        let start : number = Date.now();

        try
        {
            let full_url : string = url;
            let args : string = RestfulService.queryString( parameters );
            //console.log('args', args, url );
            if( args.length > 0 )full_url += ( '?' + args );

            const requestHeaders : any = { ...ObjectUtils.merge( this.default_headers, headers ), [ RestfulEndpoint.RestfulHeaders.TRANSACTION_ID ]: transactionId };

            //console.log(">>>>>>>> REQUEST", method, url, requestHeaders );
            const response : any = await this.client.request( {
                                                                url     : full_url,
                                                                method  : method.toLowerCase(),
                                                                data    : data,
                                                                headers : requestHeaders,
                                                                timeout : timeout ?? this.default_timeout,
                                                                onUploadProgress: onProgress
                                                            } );
            //console.log( 'resp', response );

            //console.log('<<<<<<<<<< RESPONSE headers', response.headers );

            //
            // get this last csrf header if provided
            //
            if( this.csrfTag != null )
            {
                const header_keys = Object.keys( response.headers );
                // case insensitive
                let i : number;
                for( i=0; i < header_keys.length; i++ )
                {
                    if( header_keys[i].toLowerCase() == this.csrfTag )
                    {
                        this.setHeader( this.csrfTag, response.headers[ header_keys[i] ] );

                        if( this.csrfTzTag != null )
                        {
                            this.setHeader( this.csrfTzTag, -1 * RestfulService.tzOffset() );    // why not negative for US???
                        }
                        
                        break;
                    }
                }

                //console.log('response CSRF', this.default_headers );
            }
            

            //
            // setup reply
            //
            // any 2xx is success — 200 OK, 201 Created, 202 Accepted (async/provisional), 204 No Content, …
            reply.ok       = response.status >= 200 && response.status < 300;
            reply.status   = response.status;
            reply.headers  = { ...response.headers };
            reply.data     = response.data;
            reply.duration = Date.now() - start;

            // callback monitor
            if( this.callback_monitor !== null )this.callback_monitor( method, url, response.status,reply.duration );
            return reply;
        }
        catch ( err : any )
        {
            //console.error( 'exception', err );

            const error        : AxiosError = err;

            // 401 recovery: give the registered hook ONE chance to recover (e.g. refresh the access token),
            // then retry the original request once. Guarded by isRetry so a still-401 retry can't loop.
            if( error.response?.status === NetworkUtils.Status.UNAUTHORIZED && this.unauthorizedHandler !== null && !isRetry )
            {
                const recovered : boolean = await this.unauthorizedHandler();
                if( recovered ) return await this.request( method, url, parameters, data, headers, timeout, onProgress, true );
            }

            // default
            let error_code     : string = 'EXCEPTION';
            let error_messsage : string = 'server error';
            let error_type     : string = '';
            let error_status   : number = NetworkUtils.Status.INTERNAL_SERVER_ERROR;
            let error_data     : any | undefined = undefined;

            //
            reply.duration = Date.now() - start;
            reply.ok = false;

            // type errors like 4xx/5xx type error
            if( error.response )
            {
                //console.log('client data',error.response.data);
                //console.log('client status',error.response.status);
                //console.log('client headers',error.response.headers);
                error_status = error.response.status;

                // ideally, a non-200 response is thrown here and the body returns:
                // {  code   : machine readable code that client and interpret on more why it failed,
                //    message: a human readable message on more details of the code }
                if( error.response.data !== undefined && error.response.data !== null )
                {
                    if( ( error.response.data as any ).code    )error_code     = ( error.response.data as any ).code;
                    if( ( error.response.data as any ).message )error_messsage = ( error.response.data as any ).message;
                    if( ( error.response.data as any ).type    )error_type     = ( error.response.data as any ).type;

                    // add in any raw data that was returned in the error.  This is very atypical to do this
                    error_data = error.response.data;

                    // remove fields we already have
                    if( error_data['status'] )delete error_data['status'];
                    if( error_data['code'] )delete error_data['code'];
                    if( error_data['message'] )delete error_data['message'];
                    if( error_data['type'] )delete error_data['type'];
                }
                
            }
            // do mostly from a spotty network, backend not responding instantly, unauthorized or cors issue
            else if( error.request )
            {

            }
            else
            {
                error_code = 'UNKNOWN';
            }
            
            //
            reply.status   = error_status;
            reply.error = { status : error_status, code: error_code, message: error_messsage, type: error_type, data : error_data };

            // callback monitor
            if( this.callback_monitor !== null )this.callback_monitor( method, url, error_status, Date.now() - start );

            return reply;
        }
    }
}

export namespace RestfulService
{
    export interface Error
    {
        status      : number;
        code        : string;
        message?    : string;
        type?       : string;   // T for totp, L for email verification
        data?       : any;      // optioan raw data of the error
    }

    export interface Reply<T = any>
    {
        ok            : boolean;
        data?         : T;
        status        : NetworkUtils.Status;
        headers?      : any;
        error?        : Error;
        duration      : number;
        transactionId? : string;   // the x-transactionid sent with the request (echoed by the server) — for tracing a call end-to-end
    }

    export interface Options
    {
        timeout?  : number;
        cache?    : boolean;
        lifespan? : number; // lifespan of cache in minutes
        //ignoreUriService? : boolean;
        // autorefresh
    }

    export type CallHandle = ( method: NetworkUtils.Method, url : string, status: number, duration: number ) => void;

    export type ProgressEvent = AxiosProgressEvent;
    export type ProgressCallback = ( progressEvent: ProgressEvent ) => void;

}

export default RestfulService;

//
// eof
//