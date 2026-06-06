//
import { Network } from "@repo/common";
import Access from "./Access";
import UserAgent from "./UserAgent";

import Ajv, { Schema, ValidateFunction } from "ajv";


// Query params always arrive as strings, so we coerce them to the schema's declared types.
const ajvQuery : Ajv = new Ajv({ allErrors: true, coerceTypes: true });

// JSON bodies already carry real types; coercion here would silently mutate values and mask
// genuine type errors, so body validation is a pure check.
const ajvBody : Ajv = new Ajv({ allErrors: true, coerceTypes: false });

export abstract class RestfulEndpoint<Q extends object = any, B extends object | undefined = any>
{
    // 1. Core Infrastructure Properties
    public abstract readonly uri: string;
    public abstract readonly method: Network.Method;
    public abstract readonly access: Access.Role | undefined;
    public abstract readonly timeout: number | undefined; // in milliseconds

    // Optional explicit role-set override for the rare endpoint that the linear `access`
    // ladder can't express (e.g. "billing but not account"). Defaults to none; only the
    // exceptions declare it, so concrete endpoints aren't forced to implement it.
    public readonly accessOverride: Array<Access.Role> | undefined = undefined;

    // Whether this endpoint is exposed at the public API Gateway or reachable only inside
    // the VPC. Defaults to INTERNAL (deny-by-default); public endpoints opt in explicitly.
    // The /cloud build reads this to generate API Gateway routes from the SAME definition
    // the web client (marshalClient) and the server (unmarshalServer/execute) use.
    public readonly exposure: RestfulEndpoint.Exposure = RestfulEndpoint.Exposure.INTERNAL;

    // 2. Declarative Schema Configurations
    protected abstract getMappings(): Array<RestfulEndpoint.FieldMap>;
    protected abstract getQuerySchema(): Schema | null;
    protected abstract getBodySchema(): Schema | null;

    // 3. Runtime State Containers
    public query!: Q;
    public body!: B | null;

    // Compiled AJV validators are cached per endpoint class (schemas are constant per
    // subclass), so we compile once instead of on every validate() call.
    private static validatorCache: WeakMap<Function, RestfulEndpoint.CompiledValidators> = new WeakMap();

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
        const { query: validateQuery, body: validateBody } = this.getValidators();

        if (validateQuery && !validateQuery(this.query))
        {
            return { valid: false, errors: validateQuery.errors?.map(e => `Query: ${e.instancePath} ${e.message}`) };
        }

        // A non-null body schema means a body is expected: validate even when this.body is
        // null/missing so a required-but-absent body fails instead of passing silently.
        if (validateBody && !validateBody(this.body))
        {
            return { valid: false, errors: validateBody.errors?.map(e => `Body: ${e.instancePath} ${e.message}`) };
        }

        return { valid: true };
    }

    //////////////////////////////////////////////////////////////////////////////////////////////////////////
    /**
    * Returns the compiled AJV validators for this endpoint, compiling and caching them on
    * first use. The cache is keyed by the concrete subclass since its schemas are constant.
    */
    private getValidators(): RestfulEndpoint.CompiledValidators
    {
        const ctor : Function = this.constructor;

        let cached : RestfulEndpoint.CompiledValidators | undefined = RestfulEndpoint.validatorCache.get(ctor);
        if (!cached)
        {
            const querySchema : Schema | null = this.getQuerySchema();
            const bodySchema  : Schema | null = this.getBodySchema();

            cached = {
                query: querySchema ? ajvQuery.compile(querySchema) : null,
                body : bodySchema  ? ajvBody.compile(bodySchema)   : null
            };

            RestfulEndpoint.validatorCache.set(ctor, cached);
        }

        return cached;
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
        let resolvedUri   : string = this.uri;
        //const finalBody   : Record<string, any> = {};

        for (const map of mappings)
        {
            const value = /*map.location === RestfulEndpoint.AttrLocation.BODY ? this.body?.[map.field as keyof B] :*/ this.query[map.field as keyof Q];

            if (value === undefined || value === null) continue;

            switch (map.location)
            {
                case RestfulEndpoint.AttrLocation.HEADER: headers[map.field.toLowerCase()] = String(value); break;
                case RestfulEndpoint.AttrLocation.QUERY_PARAM: queryParams.append(map.field, String(value)); break;

                // Handle both optional (:field?) and required (:field) placeholders; only the
                // matched placeholder's trailing "?" is consumed, not any other "?" in the URI.
                case RestfulEndpoint.AttrLocation.URI: resolvedUri = resolvedUri.replace(`:${map.field}?`, String(value)).replace(`:${map.field}`, String(value)); break;
            }
        }

        // Drop any optional segments (/:field?) that were never supplied a value.
        resolvedUri = resolvedUri.replace(/\/:[^/]+\?/g, "");

        resolvedUri = resolvedUri.replace(/\/+$/, "");
        const queryString : string = queryParams.toString();
        const url : string = queryString ? `${resolvedUri}?${queryString}` : resolvedUri;

        return { url : url, headers: headers, body : this.body };
    }

    //////////////////////////////////////////////////////////////////////////////////////////////////////////
    /**
    * Extracts route metadata (method/uri/exposure/access) from endpoint definitions.
    * This is the single source the /cloud build maps into API Gateway routes — the same
    * definitions the web client and server already share.
    */
    public static toRoutes( endpoints : Array<RestfulEndpoint> ) : Array<RestfulEndpoint.RouteInfo>
    {
        return endpoints.map( e => ( {
            method   : e.method,
            uri      : e.uri,
            exposure : e.exposure,
            access   : e.access,
        } ) );
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
        const parsedUriParams = RestfulEndpoint.parseUriParams( this.uri, incoming.fullPath );

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
        this.body = (incoming.body ?? null) as B | null;

        // Run an immediate AJV validation pass after server hydration
        const validation = this.validate();
        if (!validation.valid)
        {
            throw new Error(`Server Validation Error:\n${validation.errors?.join("\n")}`);
        }
    }

    //////////////////////////////////////////////////////////////////////////////////////////////////////////
    /**
    * SERVER SIDE: Clears per-request runtime state. Endpoint instances are registered once and
    * reused across requests, so this is called before each request is unmarshalled.
    */
    public reset() : void
    {
        this.query = undefined as any;
        this.body  = null;
    }

    //////////////////////////////////////////////////////////////////////////////////////////////////////////
    /**
    * Builds a standard error response payload.
    */
    public failure( status : Network.Status, message? : string ) : RestfulEndpoint.Response
    {
        const err : RestfulEndpoint.ErrorResponse = { message : message };
        return { status : status, data : err };
    }

    //////////////////////////////////////////////////////////////////////////////////////////////////////////
    /**
    * SERVER SIDE: Fulfills the request. Overridden by the concrete server-side implementation;
    * the default reports the endpoint as not implemented.
    */
    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        return this.failure( Network.Status.NOT_IMPLEMENTED, `Request not implemented yet ${this.method} @ ${this.uri}` );
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

    // Re-exported AJV schema type so endpoints can type getQuerySchema()/getBodySchema() as
    // RestfulEndpoint.Schema without importing 'ajv' directly - the validator stays an
    // implementation detail of this package.
    export type Schema = import("ajv").Schema;

    // Strongly-typed schema bound to a payload interface T: AJV's JSONSchemaType forces every
    // property of T to be described and cross-checks the schema's shape against T at compile
    // time (optional props must be marked `nullable: true` and omitted from `required`).
    export type SchemaFor<T> = import("ajv").JSONSchemaType<T>;

    export interface CompiledValidators
    {
        query : ValidateFunction | null;
        body  : ValidateFunction | null;
    }

    export interface ClientTransport
    {
        url: string;
        //method: Network.Method;
        //timeout: number;
        headers: Record<string, string>;
        body?  : Record<string, any> | null;
    }

    // Whether an endpoint is reachable from the public API Gateway or only inside the VPC.
    export enum Exposure
    {
        PUBLIC   = "public",
        INTERNAL = "internal",
    }

    // Route metadata extracted from an endpoint definition (see RestfulEndpoint.toRoutes).
    // The /cloud build maps these into API Gateway routes.
    export interface RouteInfo
    {
        method   : Network.Method;
        uri      : string;
        exposure : Exposure;
        access   : Access.Role | undefined;
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