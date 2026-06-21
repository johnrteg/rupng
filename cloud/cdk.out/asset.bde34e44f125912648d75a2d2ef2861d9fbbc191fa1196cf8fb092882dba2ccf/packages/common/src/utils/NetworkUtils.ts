//
// NetworkUtils — HTTP enums (Status / Method / Protocol / …), URL helpers, and URL/host/IP validation.
// (Absorbs the former `Network` namespace + the network validators that were in Validator.)
//
import StringUtils from "./StringUtils";

namespace NetworkUtils
{

    // https://en.wikipedia.org/wiki/List_of_HTTP_status_codes
    export enum Status { OK=200, CREATED=201, ACCEPTED=202, NON_AUTHORITATIVE_INFO=203, NO_CONTENT=204,
    PARTIAL_CONTENT=206,
    MULTI_STATUS = 207,
    ALREADY_REPORTED = 208,
    IM_USED = 226,

    MULTIPLE_CHOICES=300, MOVED_PERMANENTLY=301, FOUND=302, SEE_OTHER=303,
    NOT_MODIFIED=304, USE_PROXY=305, TEMP_REDIRECT=307,
    PERMANENT_REDIRECT = 308,

    BAD_REQUEST=400,
    UNAUTHORIZED=401,
    PAYMENT_REQD=402,
    FORBIDDEN=403,
    NOT_FOUND=404,
    NOT_ALLOWED=405,
    NOT_ACCEPTED=406,
    PROXY_AUTH_REQD=407,
    REQUEST_TIMEOUT=408,
    CONFLICT=409,
    GONE=410,
    LENGTH_REQD=411,
    PRE_CONDITION_FAILED=412,
    REQUEST_ENTITY_TOO_LONG=413, REQUEST_URI_TOO_LONG=414, UNSUPPORTED_MEDIA_TYPE=415,
    REQUESTED_RANGE_NOT_SATISFIABLE=416,
    EXPECTATION_FAILED=417,
    //IM_A_TEAPOT = 418,
    MISDIRECTED_REQUEST = 421,
    UNPROCESSABLE_ENTITY = 422,
    LOCKED = 423,
    FAILED_DEPENDENCY = 424,
    TOO_EARLY = 425,
    UPGRADE_REQUIRED = 426,
    PRECONDITION_REQUIRED = 428,
    TOO_MANY_REQUESTS = 429,
    REQUEST_HEADER_TOO_LARGE = 431,
    UNAVAILABLE_FOR_LEGAL_REASONS = 451,

    INTERNAL_SERVER_ERROR=500, NOT_IMPLEMENTED=501, BAD_GATEWAY=502, SERVICE_UNAVAIL=503, GATEWAY_TIMEOUT=504,
    HTTP_VERSION_NOT_SUPPORTED=505, VARIANT_ALSO_NEGOTIATES = 506,
    INSUFFICIENT_STORAGE = 507,
    LOOP_DETECTED = 508,
    NOT_EXTENDED = 510,
    NETWORK_AUTH_REQUIRED = 511 }

    //
    export enum Protocol { FILE="file", HTTP="http", HTTPS="https", SFTP="sftp", WS="ws", WSS="wss" }
    export const PROTOCOL_SEPARATOR : string = "://";

    export enum HeaderType
    {
        CONTENT = "Content-Type"
    }

    export interface Url
    {
        protocol    : Protocol;   // https
        domain      : string;   // acme.com
        //subdomain   : string;   // www
        port        : number;   // 80
        path        : string;   // index.html
        parameters  : any;      // foo=bar
        hash        : string;   // #part
    }

    // https://en.wikipedia.org/wiki/HTTP
    export enum Method
    {
        GET     = "GET",
        PUT     = "PUT",
        POST    = "POST",
        DELETE  = "DELETE",
        HEAD    = "HEAD",
        //COPY    = "COPY",     not suppported by fastify
        //MOVE    = "MOVE",     not suppported by fastify
        PATCH   = "PATCH",
        //TRACE   = "TRACE",    not suppported by fastify
        OPTIONS = "OPTIONS"
    }

    export enum MimeType
    {
        // data
        JSON        = "application/json",
        XML         = "application/xml",
        BIN         = "application/octet-stream",
        GZIP        = "application/gzip",
        TAR         = "application/x-tar",
        ZIP         = "application/zip",
        PDF         = "application/pdf",

        // text
        TEXT        = "text/plain",
        HTML        = "text/html",
        CSS         = "text/css",
        CSV         = "text/csv",
        ICS         = "text/ics",
        JS          = "text/javascript",

        // audio
        MP3         = "audio/mpeg",
        WAVE        = "audio/wav",

        // video
        MP4         = "video/mp4",
        MPEG        = "video/mpeg",

        // image
        JPEG        = "image/jpeg",
        PNG         = "image/png",
        GIF         = "image/gif",
        BMP         = "image/bmp"
    }

    /////////////////////////////////////////////////////////////////////////////////////////////////////
    export function toUrl( path : Url ) : string
    {
        return url( path.protocol, path.domain, path.port, path.path, path.parameters );
    }

    /////////////////////////////////////////////////////////////////////////////////////////////////////
    export function url( protocol: Protocol, host: string, port: number | null, uri: string | null, parameters: any | null ) : string
    {
        let built : string = protocol;   // local renamed (was `url`, shadowing the function)
        built += "://";
        built += host;

        if( port !== null && port > 0 )
        {
            // exclude port if standard based on protocol
            built += ":";
            built += port;
        }

        if( uri )
        {
            if( uri.charAt(0) != '/' )built += "/";
            built += uri;
        }

        if( parameters )
        {
            const keys : Array<string> = Object.keys( parameters );
            keys.forEach( ( key : string, index : number ) => {
                built += ( index === 0 ? "?" : "&" );
                built += StringUtils.format( "{0}={1}", key, parameters[key] )
                } )
        }

        return built;
    }

    /////////////////////////////////////////////////////////////////////////////////////////////////////
    export function uriParts( request_uri : string ) : Array<string>
    {
        let str : string = request_uri.toLowerCase();

        // remove any parameters
        //if( str.indexOf('?') > 0 )str = str.substring( 0, str.indexOf('?') );
        let reqs   : Array<string> = str.split('/');

        // remove any blank parts like from:
        // /v2//api// -> v2/api
        reqs = reqs.filter(n => n);
        return reqs;
    }

    /////////////////////////////////////////////////////////////////////////////////////////////////////
    export function parseUrl( full_url : string ) : Url
    {
        // `new URL()` (try/catch) instead of `URL.parse()` — the static `URL.parse` is very new and
        // missing on older browsers, and this module ships to the web bundle.
        let parsed : URL | null = null;
        try { parsed = new URL( full_url ); } catch { parsed = null; }
        let parameters  : any = {};
        let protocol    : string = parsed ? StringUtils.removeTrailing( parsed.protocol, ":" ) : NetworkUtils.Protocol.HTTPS;
        let hash        : string = "";

        // parse parameters
        let params : string = parsed ? parsed.search : "";
        if( params && params != "" )
        {
            params = params.substring(1);   // take off leading '?'

            let params_parts : Array<string> = [];

            // parse off any hash
            if( params.indexOf('#') > 0 )
            {
                params_parts = params.split('#');
                params = params_parts[0];   // was params[0] (a char) — kept the query, dropped the hash
                hash   = params_parts[1];
            }

            params_parts = params.split('&');
            params_parts.forEach( ( parts : string, index : number ) => { let nv : Array<string> = parts.split('=');
                                                                        parameters[ nv[0] ] = nv[1]; } );
        }

        // todo: enum this:
        const std_ports : any = { http: 80, https: 443, ftp: 21, file: 80, smtp: 25, ssh: 22 }

        return {    protocol    : protocol as Protocol,
                    domain      : parsed ? parsed.hostname : "",
                    port        : parsed && parsed.port ? parseInt( parsed.port ) : std_ports[protocol],

                    // odd use case:
                    // ignore trailing "/" in pathname so full domains can be parsed ( e.g. https://google.com )
                    // unless the user set the trailing "/"
                    path        : parsed ? correctPath( full_url, parsed.pathname ) : "",
                    parameters  : parameters,
                    hash        : hash };
    }

    /////////////////////////////////////////////////////////////////////////////////////////////////////
    function correctPath( original_url : string, path : string ) : string
    {
        const orig_trailing_slash : boolean = original_url.endsWith( "/" );

        let newPath : string = path;

        // Remove trailing slash from path
        if ( newPath.length >= 1 && newPath.endsWith("/") )
        {
            newPath = newPath.slice(0, -1);
        }

        // Add trailing slash back if original_url had it
        if( orig_trailing_slash && !newPath.endsWith("/") )
        {
            newPath += "/";
        }

        return newPath;
    }

    /////////////////////////////////////////////////////////////////////////////////////////////////////
    export function sameUri( request_uri : string, endpt_uri: string ) : boolean
    {
        return sameUriArray( uriParts( request_uri ), uriParts( endpt_uri ) );
    }

    /////////////////////////////////////////////////////////////////////////////////////////////////////
    //  request                     endpt                               match
    //  /v2/users/user              /v2/users/user                      true
    //  /v2/users/user/             /v2/users/user                      false
    //  /v2/users/user/378          /v2/users/user/:id                  true
    //  /v2/users/user/38/cart/34   /v2/users/user/:id/cart/:cid        true
    //  /v2/users/user/38/cart/34   /v2/users/user/:id/*                true
    //  /v2/users/user/38?q=bob     /v2/users/user/:id/*                true
    //
    export function sameUriArray( request_uri : Array<string>, endpt_uri: Array<string> ) : boolean
    {
        // work on copies — this routine pop()/splice()s as it matches; don't mutate the caller's arrays
        request_uri = [ ...request_uri ];
        endpt_uri   = [ ...endpt_uri ];

        // remove any parameters at the end of the request uri
        // /v2/food?param=color&type=apple
        if( request_uri[request_uri.length-1].indexOf('?') > 0 )
        {
            request_uri[request_uri.length-1] = request_uri[request_uri.length-1].substring( 0, request_uri[request_uri.length-1].lastIndexOf('?') );
        }

        // deal with the wildcard case  endpt: /v2/users/user/*
        if( endpt_uri[ endpt_uri.length-1 ] == '*' )
        {
            endpt_uri.pop();    // remove last, * items
            while( request_uri.length > endpt_uri.length )
            {
                request_uri.pop();
            }
        }

        let i   : number;
        let len : number = endpt_uri.length;

        // sub in request any parameters defined in the endpt (e.g. /v2/fruit/:color/shippping/:zipcode )
        for( i=0; i < len; i++ )
        {
            if( endpt_uri[ i ].charAt(0) == ':' )
            {
                if( request_uri[i] != undefined )
                {
                    request_uri[i] = endpt_uri[ i ];    // set request to the id
                }
                else if( i == len-1 && endpt_uri[ i ].charAt( endpt_uri[ i ].length - 1 ) == '?' )
                {
                    endpt_uri.splice(i,1);
                    break;
                }
                else
                {
                    return false;
                }
            }
        }

        if( request_uri.length !== endpt_uri.length )return false;
        return request_uri.join('/') === endpt_uri.join('/');
    }

    //
    // ── URL / hostname / IPv4 validation (moved from Validator) ─────────────────────────────────
    //

    /** Dotted hostname: alnum/hyphen labels (no leading/trailing/double dots) + a 2+ letter TLD. */
    const HOSTNAME : RegExp = /^(?=.{1,253}$)([a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/;
    /** A single IPv4 octet, 0-255. */
    const OCTET    : RegExp = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/;

    ///////////////////////////////////////////////////////////////////////////////////////////////////////
    /** Valid **HTTP/HTTPS** URL with a dotted hostname + TLD (rejects ftp://, no-TLD hosts, garbage). */
    export function isUrl( value : string ) : boolean
    {
        try
        {
            const parts : URL = new URL( value );
            const protocolValid : boolean = parts.protocol === "http:" || parts.protocol === "https:";
            return protocolValid && HOSTNAME.test( parts.hostname );   // reuse the strict hostname check
        }
        catch
        {
            return false;
        }
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////////
    /** Valid dotted **hostname** (no leading/trailing/double dots) ending in a 2+ letter TLD. */
    export function isHostname( hostname : string ) : boolean
    {
        return StringUtils.isValid( hostname ) && HOSTNAME.test( hostname );
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////////
    /** Valid **IPv4** address — exactly 4 octets, each a digits-only 0-255. */
    export function isIpAddress( value : string ) : boolean
    {
        if( !StringUtils.isValid( value ) ) return false;
        const parts : Array<string> = value.split( "." );
        return parts.length === 4 && parts.every( ( octet : string ) : boolean => OCTET.test( octet ) );
    }

}

export default NetworkUtils;

//
// eof
//
