//
import { Network } from "@repo/common";
import Access from "./Access";
import UserAgent from "./UserAgent";

import Ajv, { Schema } from "ajv";


const ajv : Ajv = new Ajv({ allErrors: true, coerceTypes: true });

export abstract class RestfulEndpoint<Q extends object = any, B extends object = any>
{
    // 1. Core Infrastructure Properties
    public abstract readonly pathPattern: string;
    public abstract readonly method: Network.Method;
    public abstract readonly access: Access.Role | undefined;
    public abstract readonly timeout: number | undefined; // in milliseconds

    // 2. Declarative Schema Configurations
    protected abstract getMappings(): Array<RestfulEndpoint.FieldMap>;
    protected abstract getQuerySchema(): Schema | null;
    protected abstract getBodySchema(): Schema | null;

    // 3. Runtime State Containers
    public query!: Q;
    public body!: B | null;

    //////////////////////////////////////////////////////////////////////////////////////////////////////////
    /**
    * Initializes the endpoint workspace parameters
    */
    constructor(query: Q, body?: B)
    {
        this.query = query;
        this.body = body || null;
    }

    //////////////////////////////////////////////////////////////////////////////////////////////////////////
    /**
    * VALIDATION LAYER: Checks runtime object parameters against declarative AJV definitions
    */
    public validate(): RestfulEndpoint.Validate
    {
        const querySchema = this.getQuerySchema();
        if (querySchema)
        {
            const validateQuery = ajv.compile(querySchema);
            if (!validateQuery(this.query))
            {
                return { valid: false, errors: validateQuery.errors?.map(e => `Query: ${e.instancePath} ${e.message}`) };
            }
        }

        const bodySchema : Schema | null = this.getBodySchema();
        if( bodySchema && this.body )
        {
            const validateBody = ajv.compile(bodySchema);
            if (!validateBody(this.body))
            {
                return { valid: false, errors: validateBody.errors?.map(e => `Body: ${e.instancePath} ${e.message}`) };
            }
        }

        return { valid: true };
    }

    //////////////////////////////////////////////////////////////////////////////////////////////////////////
    /**
    * CLIENT SIDE: Marshals internal objects out to a clean transport package payload
    */
    public marshalClient() : RestfulEndpoint.ClientTransport
    {
        // Run an internal validation pass before code leaves the client engine boundary
        const validation = this.validate();
        if( !validation.valid )
        {
            throw new Error(`Client Validation Failed:\n${validation.errors?.join("\n")}`);
        }

        const mappings    : Array<RestfulEndpoint.FieldMap> = this.getMappings();
        const headers     : Record<string, string> = {};
        const queryParams : URLSearchParams = new URLSearchParams();
        let resolvedUri   : string = this.pathPattern;
        //const finalBody   : Record<string, any> = {};

        for (const map of mappings)
        {
            const value = /*map.location === RestfulEndpoint.AttrLocation.BODY ? this.body?.[map.field as keyof B] :*/ this.query[map.field as keyof Q];

            if (value === undefined || value === null) continue;

            switch (map.location)
            {
                case RestfulEndpoint.AttrLocation.HEADER: headers[map.field.toLowerCase()] = String(value); break;
                case RestfulEndpoint.AttrLocation.QUERY_PARAM: queryParams.append(map.field, String(value)); break;
                //case RestfulEndpoint.AttrLocation.BODY: finalBody[map.field] = value; break;
                case RestfulEndpoint.AttrLocation.URI: resolvedUri = resolvedUri.replace(`:${map.field}`, String(value)).replace("?", ""); break;
            }
        }

        resolvedUri = resolvedUri.replace(/\/+$/, "");
        const queryString : string = queryParams.toString();
        const url : string = queryString ? `${resolvedUri}?${queryString}` : resolvedUri;

        return { url : url, headers: headers, body : this.body };

        /*
        return {
        url,
        method: this.method,
        timeout: this.timeout,
        headers,
        body: Object.keys(finalBody).length > 0 ? finalBody : null
        };
        */
    }

    //////////////////////////////////////////////////////////////////////////////////////////////////////////
    /**
    * Extracts dynamic path parameters from a URI based on a route pattern.
    * 
    * @param pattern - The route template with placeholders (e.g., "/users/:id/posts/:postId")
    * @param full_path - The actual incoming URL path (e.g., "/users/123/posts/456")
    * @returns An object map of parsed parameter keys and values (e.g., { id: "123", postId: "456" })
    */
    public static parseUriParams(pattern: string, full_path: string): Record<string, string>
    {
        const params: Record<string, string> = {};

        // Strip query strings or hashes if they are present in the full_path
        const cleanPath : string = full_path.split(/[?#]/)[0];

        // Split both paths into segments, filtering out empty segments caused by slashes
        const patternSegments : Array<string> = pattern.split('/').filter(Boolean);
        const pathSegments  : Array<string> = cleanPath.split('/').filter(Boolean);

        // iterate with separate indices so optional pattern segments can be skipped
        let pIdx : number = 0;
        let sIdx : number = 0;

        while (pIdx < patternSegments.length)
        {
            const patternSeg : string = patternSegments[pIdx];
            const pathSeg    : string = pathSegments[sIdx];

            if (patternSeg.startsWith(':'))
            {
                const isOptional : boolean = patternSeg.endsWith('?');
                const paramName  : string = isOptional ? patternSeg.slice(1, -1) : patternSeg.slice(1);

                if (pathSeg !== undefined)
                {
                    params[paramName] = decodeURIComponent(pathSeg);
                    sIdx++; // consume path segment
                }
                else
                {
                    if (!isOptional)
                    {
                        // required param missing
                        return {};
                    }
                    // optional param absent -> leave undefined and continue
                }
            }
            else
            {
                // static segment must match the current path segment
                if (pathSeg === undefined || patternSeg !== pathSeg)
                {
                    return {};
                }
                sIdx++; // consume path segment
            }

            pIdx++;
        }

        // If there are leftover path segments, it doesn't match the pattern
        if (sIdx !== pathSegments.length)
        {
            return {};
        }

        return params;
    }

    //////////////////////////////////////////////////////////////////////////////////////////////////////////
    /**
    * SERVER SIDE: Unmarshals all HTTP incoming fragments back into unified class types
    */
    public unmarshalServer( incoming: { headers: any; query: any; fullPath: string; body: any }): void
    {
        const mappings : Array<RestfulEndpoint.FieldMap> = this.getMappings();
        const parsedUriParams = RestfulEndpoint.parseUriParams( this.pathPattern, incoming.fullPath );

        const extractedQuery: any = {};
        //const extractedBody: any = {};

        for (const map of mappings)
        {
            let rawValue: any = undefined;

            switch (map.location)
            {
                case RestfulEndpoint.AttrLocation.URI: rawValue = parsedUriParams[map.field]; break;
                case RestfulEndpoint.AttrLocation.HEADER: rawValue = incoming.headers[map.field.toLowerCase()]; break;
                case RestfulEndpoint.AttrLocation.QUERY_PARAM: rawValue = incoming.query?.[map.field]; break;
               // case RestfulEndpoint.AttrLocation.BODY: rawValue = incoming.body?.[map.field]; break;
            }

            if (rawValue === undefined || rawValue === null) continue;

            //if (map.location === RestfulEndpoint.AttrLocation.BODY)
            //{
            //    extractedBody[map.field] = rawValue;
            //}
            //else
            //{
                extractedQuery[map.field] = rawValue;
            //}
        }

        this.query = extractedQuery;
        //this.body = Object.keys(extractedBody).length > 0 ? extractedBody : null;

        // Run an immediate AJV validation pass after server hydration
        const validation = this.validate();
        if (!validation.valid)
        {
            throw new Error(`Server Validation Error:\n${validation.errors?.join("\n")}`);
        }
    }
}


//
//
//
export namespace RestfulEndpoint
{
   
    export enum RestfulHeaders
    {
        //APP_ID         = "x-appid",
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

    export interface Validate
    {
        valid : boolean;
        errors? : Array<string>;
    }

    export interface ClientTransport
    {
        url: string;
        //method: Network.Method;
        //timeout: number;
        headers: Record<string, string>;
        body: Record<string, any> | null;
    }

/*
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
*/

    export enum AttrLocation
    {
        HEADER = "header",
        URI = "uri",
        QUERY_PARAM = "param",
        //BODY = "body"
    }

    export interface FieldMap
    {
        field       : string;
        location    : AttrLocation;
        required?   : boolean;
        //type?       : "string" | "number" | "boolean" | "object";
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
        //userId?    : string;
        //devToken?  : string;
        //sessionId? : string;
    }


}

export default RestfulEndpoint;