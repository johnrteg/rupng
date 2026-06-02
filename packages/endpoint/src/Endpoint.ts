//
import { FastifyRequest } from "fastify";

import { Network } from "@repo/common";

import Access from "./Access";
import UserAgent from "./UserAgent";

export interface BaseQueryParams
{
}
export interface BaseBodyPayload
{
}

/*
    Query are parameters in the uri, query after the uri, or in the header.  All name-value pairs.
        The mapping marshals on and off those areas to provide a unified interface to the query.
    Body (optional) is the payload for PUT and POST
*/
export abstract class BaseEndpoint<Q extends BaseQueryParams, B extends BaseBodyPayload = any>
{
    public query: Q;
    public body: B | null;

    protected abstract getMappings(): Array<Endpoint.FieldMapping>;
    protected abstract getPathPattern(): string;

    constructor(query: Q, body?: B)
    {
        this.query = query;
        this.body = body || null;
    }
}

//
//
//
export abstract class Endpoint
{
    public uri     : string;
    public method  : Network.Method;
    public access? : Access.Role;       // undefined access means non-authenticated endpoint
    public timeout  : number | null;

    protected request? : Endpoint.Request;

    /////////////////////////////////////////////////////////////////////////////////////////////////
    constructor( method : Network.Method, uri : string, access : Access.Role | undefined = undefined, timeout  : number | null = null )
    {
        this.method = method;
        this.uri = uri;
        this.access = access;
        this.timeout         = timeout;
        this.reset();
    }

    //
    // child classes must implate the mapping for the request
    //
    protected abstract getMappings(): Array<Endpoint.FieldMapping>;

    public reset() : void
    {
        this.request = undefined;
    }


/*
    public url() : string
    {
        return this.uri;
    }

    public body() : any | undefined
    {
        return undefined;
    }

    public header() : any | undefined
    {
        return undefined;
    }
    */

    //////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    public validate( request : Endpoint.ClientRequest ) : Endpoint.Response
    {
        //
        // unmarshall the data from the client request 
        //

        // validate the marshalled data
        let check : Endpoint.DataCheck = this.validateData( request );
        if( !check.ok )return this.failure( Network.Status.BAD_REQUEST, check.message );

        // passes
        return { status: Network.Status.OK };
    }

    //////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    //
    // child classes need to override this method
    // take the request and set this.request values
    //
    public validateData( request : Endpoint.ClientRequest ) : Endpoint.DataCheck
    {
        //console.log('validateData', request );
        return { ok : true };   // default
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // overrride by child implementation on the service
    public async execute( auth : Endpoint.Authentication ) : Promise<Endpoint.Response>
    {
        return this.failure( Network.Status.NOT_IMPLEMENTED, "Request not implemented yet " + this.method + " @ " + this.uri );
    }

    //////////////////////////////////////////////////////////////////////////////////
    public failure( status: Network.Status, message? : string ) : Endpoint.Response
    {
        const err : Endpoint.ErrorResponse = { message : message };
        return { status: status, data: err };
    }

    //////////////////////////////////////////////////////////////////////////////////
    /*
        const pattern : string = "/hello/:id/:parent";
        const actualUrl : string = "/hello/A34/B17";
        {
            id: "A34",
            parent: "B17"
        }

        support optional params like: "/hello/:id/:parent?";
    */
    private parseUriParams(pattern: string, actualUrl: string): Record<string, string>
    {
        const params: Record<string, string> = {};

        // 1. Extract parameter names and check if they end with a "?" (indicating optional)
        const paramNames: Array<string> = [];
        const isOptional: Array<boolean> = [];
        
        // This regex captures the name and check if it has an optional trailing "?"
        const paramRegex : RegExp = /:([a-zA-Z0-9_]+)(\?)?/g;
        let match : RegExpExecArray | null;
        
        while ((match = paramRegex.exec(pattern)) !== null)
        {
            paramNames.push(match[1]);          // The field name (e.g. "parent")
            isOptional.push(match[2] === "?"); // True if it has the "?" suffix
        }

        // 2. Dynamically build a strict regex matcher string
        let regexString : string = pattern;

        // Escape basic forward slashes that are completely required
        regexString = regexString.replace(/\//g, '\\/');

        // Replace each parameter pattern sequence with a specific capture group
        let i : number;
        for ( i = 0; i < paramNames.length; i++)
        {
            const name : string = paramNames[i];
            
            if (isOptional[i])
            {
                // For optional parameters: make the slash AND the segment optional
                // Replaces "\/:parent\?" with "(?:\/([^/]+))?"
                const optionalTarget : RegExp = new RegExp(`\\\\\\/:${name}\\\\\\?`, 'g');
                regexString = regexString.replace(optionalTarget, '(?:\\/([^/]+))?');
            }
            else
            {
                // For required parameters: match any sequence up to the next slash
                // Replaces ":id" with "([^/]+)"
                const requiredTarget : RegExp = new RegExp(`:${name}`, 'g');
                regexString = regexString.replace(requiredTarget, '([^/]+)');
            }
        }

        // 3. Execute the regex match against the actual incoming URL
        const matcher : RegExp = new RegExp(`^${regexString}$`);
        const urlMatches : RegExpMatchArray | null = actualUrl.match(matcher);

        // 4. Map the captured array blocks back into our return object properties
        if (urlMatches)
        {
            // Capture groups start at index 1 of the match array
            let groupIndex = 1;
            for (let i = 0; i < paramNames.length; i++)
            {
                const value = urlMatches[groupIndex];
                if (value !== undefined)
                {
                    params[paramNames[i]] = value;
                }
                groupIndex++;
            }
        }

        return params;
    }


    //////////////////////////////////////////////////////////////////////////////////
    public unmarshalServer(incoming: Endpoint.ClientRequest ): void
    {
        const mappings : Array<Endpoint.FieldMapping> = this.getMappings();

        for (const map of mappings)
        {
            let raw_value: any = undefined;

            // todo
            // take uri of /hello/:id/:parent and get 'id' and 'parent' out of request

            // Extract from the corresponding HTTP source partition
            switch( map.location )
            {
                case Endpoint.AttrLocation.HEADER       : raw_value = incoming.header[map.field.toLowerCase()]; break;
                case Endpoint.AttrLocation.QUERY_PARAM  : raw_value = incoming.parameters?.[map.field]; break;
                //case Endpoint.AttrLocation.BODY         : raw_value = incoming.body?.[map.field]; break;
                //case Endpoint.AttrLocation.URI          : rawValue = incoming.parameters?.[map.field];
                break;
            }

            if (raw_value === undefined || raw_value === null)
            {
                if (map.required) throw new Error(`Server Missing Required Parameter: ${map.field}`);
                continue;
            }

            // Automatically execute primitive type coercion if mapping hints exist
            if (map.type)
            {
                if( map.type === "number"  )raw_value = Number(raw_value);
                if( map.type === "boolean" )raw_value = raw_value === "true" || raw_value === true;
            }

            // Assign the value directly into the runtime object property
            //(this as any)[map.field] = rawValue;
        }
    }

    /*
    public method           : Network.Method = Network.Method.GET; 
    public url              : string = "";        // /session/login/:id

    protected datamap       : any;
    public request          : any | null = null;

    ///////////////////////////////////////////////////////////////////////////
    constructor(    method   : Network.Method,
                    url      : string )
    {
        this.method = method;
        this.url = url;
    }

    /////////////////////////////////////////////////////////////////////////////////////////////
    public reset() : void
    {
    }

    //////////////////////////////////////////////////////////////////////////////////
    public failure( status: Network.Status, code:  Network.Status, message? : string ) : Endpoint.Reply
    {
        return { status: status, data: { code: code, message: message } };
    }

    //////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    public validate( request : FastifyRequest ) : Endpoint.Reply
    {
        if( this.method === Network.Method.GET && this.body !== null )
        {
            return this.failure( Network.Status.BAD_REQUEST, Network.Status.BAD_REQUEST, "GET cannot have BODY attributes" );
        }
        else
        {
            let check : Endpoint.DataCheck = this.validateData( request );
            if( !check.ok )return this.failure( Network.Status.BAD_REQUEST, Network.Status.BAD_REQUEST, check.message );
        }
        return { status: Network.Status.OK };
    }

    /////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    // validates the data from the different sources (headers, parameters, queries, body) back to the request.
    protected validateData( request : FastifyRequest ) : Endpoint.DataCheck
    {
        let reply : Endpoint.DataCheck = { ok: true };
        let key   : string;
        let field : string;

        //console.log( 'validateData', request.body );

        for( key in this.datamap )
        {
            field = this.datamap[key].field !== undefined ? this.datamap[key].field : key;
            //console.log('validate', key, field, this.datamap[key].source, request.headers[field] );
            switch( this.datamap[key].source )
            {
                case Endpoint.Source.HEADER : this.request[key] = request.headers[field]         != undefined ? request.headers[field] as string : null; break;
                case Endpoint.Source.PARAM  : this.request[key] = (request.params as any)[field] != undefined ? (request.params as any)[field]   : null; break;
                case Endpoint.Source.QUERY  : this.request[key] = (request.query as any)[field]  != undefined ? (request.query as any)[field]    : null; break;
                case Endpoint.Source.BODY   : this.request[key] = (request.body as any)[field]   != undefined ? (request.body as any)[field]     : null; break;
                default       : console.warn( 'unknown source of ' + this.datamap[key].source + ' in ' + this.url ); break;
            }

            //console.log( this.url, key, this.request[key], this.datamap[key].required );

            if(   this.datamap[key].required
                && ( this.request[key] === undefined || this.request[key] === null )
                && reply.ok )
            {
                reply.message = "required data at '" + key+"'/'"+ field + "' in " + this.datamap[key].source + " for " + this.url + " is missing";
                reply.ok = false;
            }
        }

        return reply;
    }


    //////////////////////////////////////////////////////////////////////////////
    public get headers() : any
    {
        return this.data( Endpoint.Source.HEADER );
    }

    ///////////////////////////////////////////////////////////////////////////////
    private data( source : Endpoint.Source ) : any
    {
        let data  : any = null;
        let key   : string;
        let field : string;
  
        //if( this.request !== Endpoint.InitValue )
        //{
            for( key in this.datamap )
            {
                // did the map have an over-ride of it's name to a different field name
                field = this.datamap[key].field !== undefined ? this.datamap[key].field : key;
                if( this.datamap[key].source == source )
                {
                    // the request attribute has been set
                    if( this.request[key] !== undefined )
                    {
                        // not set yet, initialize it
                        if( data === null )data = {};

                        // extract the request value to the source object
                        data[field] = this.request[key];
                    }
                    // no reason to warn here since there are usecases
                    // where the value is in the header and not set in the request
                    // but is extracted properly in the sserver.
                    
                    //else if( this.datamap[key].required )
                    //{
                    //    console.warn( "request not defined or missing attr for", source, key, field, this.method, this.url );
                    //}
                }
            }
        //} // endif

        return data;
    }

    ///////////////////////////////////////////////////////////////////////////////
    public get body() : any | null
    {
        return this.data( Endpoint.Source.BODY );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // overrride by child implementation on the service
    public async execute( auth : Endpoint.Authenticated ) : Promise<Endpoint.Reply>
    {
        return this.failure( Network.Status.NOT_IMPLEMENTED, Network.Status.NOT_IMPLEMENTED,
                            "request not implemented yet " + this.method + " @ " + this.url );
    }
    */
}

export namespace Endpoint
{
   
    export enum Headers
    {
        APP_ID         = "x-appid",
        TRANSACTION_ID = "x-transactionid",
        SESSION_ID     = "x-sessionid",
        DEVKEY         = "x-devkey",
        IDENTITY       = "x-identity",
        STATS          = "x-status",
        //DOMAIN         = "x-domain"
    }

    export interface DataCheck
    {
        ok       : boolean;
        message? : string;
    }

    //
    // request interfaces
    //
    export interface Request
    {
    }

    // if an authentication is needed
    // properties needed to send to server (e.g. jwt)
    export interface AuthRequest extends Request
    {
    }

    //
    // if no authentication is needed, use this interface
    //
    export interface NonAuthRequest extends Request
    {
    }

    export enum AttrLocation
    {
        HEADER = "header",
        URI = "uri",
        QUERY_PARAM = "param",
        //BODY = "body"
    }

    export interface FieldMapping
    {
        field       : string;
        location    : AttrLocation;
        required?   : boolean;
        type?       : "string" | "number" | "boolean" | "object";
    }


    export interface ClientRequest
    {
        host        : string;
        header?     : any;
        body?       : any;
        uri         : string;
        parameters  : any;        // key value
        userAgent   : UserAgent.Info;
    }

    //
    // response interfaces
    //
    export interface ErrorResponse
    {
        message? : string;
    }

    export interface Response
    {
        status : Network.Status;
        data?  : any | ErrorResponse;
    }

    // returned in header under Headers.STATS
    export interface Stats
    {
        duration : number;
    }

    //
    // for AuthRequest, this information is passed along
    //
    export interface Authentication
    {
        userId?    : string;
        devToken?  : string;
        sessionId? : string;
    }


}

export default Endpoint;