//
import { NetworkUtils, UserAgent } from "@repo/common";
import Access from "./Access";

import Ajv, { Schema, ValidateFunction } from "ajv";


// Query params always arrive as strings, so we coerce them to the schema's declared types.
const ajvQuery : Ajv = new Ajv({ allErrors: true, coerceTypes: true });

// JSON bodies already carry real types; coercion here would silently mutate values and mask
// genuine type errors, so body validation is a pure check.
const ajvBody : Ajv = new Ajv({ allErrors: true, coerceTypes: false });

export abstract class RestfulEndpoint<Q extends object = any, B extends object | undefined = any, R = any>
{
    // Phantom type carrier — has NO runtime value (`declare`), it only makes the endpoint's Response
    // type (the 3rd generic) structurally present so `RestfulService.fetch( endpoint )` can INFER it
    // and return `RestfulService.Reply<Response>`. An unused generic alone isn't inferable.
    declare readonly _response: R;

    // 1. Core Infrastructure Properties
    public abstract readonly uri: string;
    public abstract readonly method: NetworkUtils.Method;
    public abstract readonly access: Access.Role | undefined;
    public abstract readonly timeout: number | undefined; // in milliseconds

    // Optional explicit role-set override for the rare endpoint that the linear `access`
    // ladder can't express (e.g. "billing but not account"). Defaults to none; only the
    // exceptions declare it, so concrete endpoints aren't forced to implement it.
    public readonly accessOverride: Array<Access.Role> | undefined = undefined;

    // AUDIENCE — WHO an endpoint is for + whether it's PUBLISHED, in one deny-by-default field:
    //   INTERNAL — service-to-service, VPC only (no edge route).
    //   APP      — first-party web/mobile app: edge-reachable + JWT, but NOT in the public dev API/docs.
    //   PUBLIC   — published developer API: edge + dev-key/JWT, documented (toOpenApi) + version-stable.
    // This supersedes the old binary "exposure"; network reachability is now DERIVED from it (below).
    // The /cloud build + authorizer read it (via `exposure`) from the SAME definition the web client
    // (marshalClient) and server (unmarshalServer/execute) share. Only PUBLIC is emitted to dev docs.
    public readonly audience: RestfulEndpoint.Audience = RestfulEndpoint.Audience.INTERNAL;

    // NetworkUtils reachability, DERIVED from audience (edge for APP/PUBLIC, VPC for INTERNAL). Kept so the
    // /cloud route builder + auth artifact keep one "is this edge-reachable?" signal unchanged.
    public get exposure(): RestfulEndpoint.Exposure
    {
        return this.audience === RestfulEndpoint.Audience.INTERNAL
            ? RestfulEndpoint.Exposure.INTERNAL
            : RestfulEndpoint.Exposure.PUBLIC;
    }

    // Optional doc metadata (summary/description/tags/examples) — lives WITH the definition so the
    // generated OpenAPI can't drift from the code. Only consumed for PUBLIC endpoints (see toOpenApi).
    public readonly docs?: RestfulEndpoint.Docs;

    // 2. Declarative Schema Configurations
    protected abstract getMappings(): Array<RestfulEndpoint.FieldMap>;
    protected abstract getQuerySchema(): Schema | null;
    protected abstract getBodySchema(): Schema | null;
    // Optional success-response body shape (JSON Schema) — powers the response section of the docs.
    // Defaults to none; override to document what an endpoint returns. (JSON Schema == OpenAPI 3.1.)
    protected getResponseSchema(): Schema | null { return null; }

    // 3. Runtime State Containers
    public query!: Q;
    public body!: B | null;
    // TRUE raw request bytes, present only when the owning `Service` called `enableRawBodyCapture()` (see
    // packages/services/src/Service.ts) — needed by webhook signature schemes that HMAC over raw bytes
    // (`Webhook.hmacSha256RawBody`), since a re-serialized `body` isn't guaranteed to match what was signed.
    // Typed `Uint8Array`, not Node's `Buffer` (which IS a `Uint8Array`) — this class is shared by the browser
    // client (`marshalClient`), whose tsconfig has no Node types.
    public rawBody? : Uint8Array;

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
    * Generate an **OpenAPI 3.1** document from the endpoint definitions — the SAME source of truth the
    * client (marshalClient) and server (unmarshalServer) already use, so the docs **cannot drift** from
    * the code. Only **PUBLIC** endpoints are included (APP/INTERNAL are first-party/private). Because
    * JSON Schema *is* OpenAPI 3.1, the query/body/response schemas embed directly — no translation.
    * Run it in the build (and diff the output in CI) to keep published docs/SDKs in lockstep.
    */
    public static toOpenApi( endpoints : Array<RestfulEndpoint>, info : RestfulEndpoint.OpenApi.Info ) : RestfulEndpoint.OpenApi.Document
    {
        const paths : Record<string, Record<string, unknown>> = {};

        for( const endpoint of endpoints )
        {
            if( endpoint.audience !== RestfulEndpoint.Audience.PUBLIC ) continue;   // publish only PUBLIC

            const path           : string         = RestfulEndpoint.toOpenApiPath( endpoint.uri );
            const body           : Schema | null   = endpoint.getBodySchema();
            const responseSchema : Schema | null   = endpoint.getResponseSchema();
            const secured        : boolean         = endpoint.access !== undefined;

            // the endpoint's declared error responses (status → description), merged into the standard set
            const declaredErrors : Record<string, { description : string }> = {};
            for( const [ status, description ] of Object.entries( ( endpoint.docs?.errors ?? {} ) as Record<string, string> ) )
                declaredErrors[ status ] = { description };

            const operation : Record<string, unknown> = {
                operationId : endpoint.docs?.operationId ?? endpoint.constructor.name,
                summary     : endpoint.docs?.summary,
                description : endpoint.docs?.description,
                tags        : endpoint.docs?.tags,
                deprecated  : endpoint.docs?.deprecated,
                parameters  : RestfulEndpoint.toOpenApiParams( endpoint ),
                requestBody : body ? { required: true, content: { "application/json": { schema: body } } } : undefined,
                responses   : {
                    "200": { description: "Success", ...( responseSchema ? { content: { "application/json": { schema: responseSchema } } } : {} ) },
                    "400": { description: "Validation error" },
                    ...( secured ? { "401": { description: "Unauthenticated" }, "403": { description: "Forbidden" } } : {} ),
                    ...declaredErrors,   // endpoint-specific errors (e.g. 404 Not found) from docs.errors
                },
                security    : secured ? [ { bearer: [] } ] : [],
                // vendor extension: the RBAC minimum role a caller needs (drives the docs' auth/role chips).
                // Absent when the endpoint is unauthenticated (access === undefined).
                ...( secured ? { "x-min-role": endpoint.access } : {} ),
            };

            ( paths[ path ] ??= {} )[ endpoint.method.toLowerCase() ] = operation;
        }

        return {
            openapi    : "3.1.0",
            info,
            paths,
            components : {
                // ONE scheme: the developer API key is a bearer token `Authorization: Bearer rup_<keyId>.<secret>`
                // (not a JWT — same header the platform Authorizer verifies). See auth ApiKey / Authorizer.verifyApiKey.
                securitySchemes : {
                    bearer : { type: "http", scheme: "bearer", description: "Developer API key — `Authorization: Bearer rup_<keyId>.<secret>` (create one under Settings → API)." },
                },
            },
        };
    }

    /** Convert a route template's `:param` / `:param?` placeholders to OpenAPI `{param}`. */
    private static toOpenApiPath( uri : string ) : string
    {
        return uri.replace( /:([^/?]+)\??/g, "{$1}" );
    }

    /** Build OpenAPI `parameters` (path/header/query) from an endpoint's field mappings + query schema. */
    private static toOpenApiParams( endpoint : RestfulEndpoint ) : Array<Record<string, unknown>>
    {
        const locationIn : Record<RestfulEndpoint.AttrLocation, string> = {
            [ RestfulEndpoint.AttrLocation.URI ]         : "path",
            [ RestfulEndpoint.AttrLocation.HEADER ]      : "header",
            [ RestfulEndpoint.AttrLocation.QUERY_PARAM ] : "query",
        };
        const querySchema : Schema | null = endpoint.getQuerySchema();
        const props : Record<string, unknown> = ( typeof querySchema === "object" && querySchema !== null )
            ? ( ( querySchema as { properties? : Record<string, unknown> } ).properties ?? {} )
            : {};

        return endpoint.getMappings().map( ( map : RestfulEndpoint.FieldMap ) => ( {
            name     : map.field,
            in       : locationIn[ map.location ],
            required : map.location === RestfulEndpoint.AttrLocation.URI || map.required === true,
            schema   : props[ map.field ] ?? { type: "string" },
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
    public unmarshalServer( incoming: { headers: any; query: any; fullPath: string; body: any; rawBody?: Uint8Array }): void
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
        this.rawBody = incoming.rawBody;

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
        this.query   = undefined as any;
        this.body    = null;
        this.rawBody = undefined;
    }

    //////////////////////////////////////////////////////////////////////////////////////////////////////////
    /**
    * Builds a standard error response payload.
    */
    public failure( status : NetworkUtils.Status, message? : string ) : RestfulEndpoint.Response
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
        return this.failure( NetworkUtils.Status.NOT_IMPLEMENTED, `Request not implemented yet ${this.method} @ ${this.uri}` );
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
        //method: NetworkUtils.Method;
        //timeout: number;
        headers: Record<string, string>;
        body?  : Record<string, any> | null;
    }

    // NetworkUtils reachability (derived from Audience): edge-reachable vs VPC-only.
    export enum Exposure
    {
        PUBLIC   = "public",
        INTERNAL = "internal",
    }

    // WHO an endpoint is for + whether it's PUBLISHED. Supersedes the binary Exposure (which derives
    // from this). It's an ascending LADDER, not a union — each level includes the access of the one
    // below, so you pick exactly ONE value:
    //   INTERNAL — service-to-service, VPC only (service/IAM auth).
    //   APP      — first-party web/mobile app: edge, JWT only, NOT published.
    //   PUBLIC   — published developer API: edge, JWT *or* dev-key, documented + version-stable.
    // **PUBLIC assumes APP** — a public endpoint is also app-callable (a JWT works on it); it just
    // ADDITIONALLY accepts a dev-key and appears in the docs. The "JWT or dev-key" OR lives at the
    // CREDENTIAL layer (the authorizer derives accepted credentials from audience), not here — you
    // never tag an endpoint APP+PUBLIC. (A rare dev-key-only/no-session endpoint would be a separate
    // flag, not a fourth audience.)
    export enum Audience
    {
        INTERNAL = "internal",   // service-to-service, VPC only (service/IAM auth)
        APP      = "app",        // first-party app — edge, JWT only, NOT published
        PUBLIC   = "public",     // published dev API — edge, JWT OR dev-key, documented + versioned (⊇ APP)
    }

    // Documentation metadata attached to an endpoint definition (feeds toOpenApi). Per-field
    // descriptions/examples live in the JSON Schemas themselves (the `description`/`examples` keywords).
    export interface Docs
    {
        summary?     : string;                    // one-line operation summary
        description? : string;                    // longer markdown description
        tags?        : Array<string>;             // grouping in the docs (e.g. "Contacts")
        operationId? : string;                    // stable id for SDK codegen (default: the class name)
        deprecated?  : boolean;
        examples?    : Record<string, unknown>;   // example request/response payloads
        errors?      : Record<number, string>;    // endpoint-specific error responses: HTTP status → description
                                                  // (e.g. `{ 404: "Project not found" }`) — merged into the docs
                                                  // responses on top of the standard 400/401/403. Mirror the
                                                  // namespace `Error` enum here so the spec lists real failures.
    }

    // Route metadata extracted from an endpoint definition (see RestfulEndpoint.toRoutes).
    // The /cloud build maps these into API Gateway routes.
    export interface RouteInfo
    {
        method   : NetworkUtils.Method;
        uri      : string;
        exposure : Exposure;
        access   : Access.Role | undefined;
    }

    // Minimal OpenAPI 3.1 shapes for the generated document (see RestfulEndpoint.toOpenApi).
    export namespace OpenApi
    {
        export interface Info { title : string; version : string; description? : string; }
        export interface Document
        {
            openapi     : string;
            info        : Info;
            paths       : Record<string, Record<string, unknown>>;
            components? : Record<string, unknown>;
        }
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
        status      : NetworkUtils.Status;
        data?       : any | ErrorResponse;
        // Override the reply's Content-Type (defaults to JSON in Service.processEndpoint) for an endpoint whose
        // `data` is already a serialized non-JSON body — e.g. a synchronous provider call-control webhook that
        // must reply with TwiML (`NetworkUtils.MimeType.XML`), not a JSON envelope.
        contentType? : string;
        // Extra reply headers (applied before `data` is sent) — e.g. `Location` for a real 3xx redirect
        // (links' resolve endpoint: a browser needs an actual `Location` header, not a JSON body naming
        // the target). Rare — most endpoints omit this.
        headers?     : Record<string, string>;
    }

    // returned in header under Headers.STATS
    export interface Stats
    {
        duration : number;
    }

    //
    // Resolved caller context, passed to execute(). Populated by the service from the request's
    // bearer token (and, in production, the Lambda authorizer). Empty when unauthenticated.
    //
    export interface Authentication
    {
        userId?    : string;                   // the caller's stable id (Cognito sub)
        username?  : string;                   // the caller's username / login
        token?     : string;                   // the raw bearer access token (for downstream calls e.g. GlobalSignOut)
        claims?    : Record<string, unknown>;  // decoded token claims (sub, email, roles, …)
        transactionId? : string;               // this request's correlation id (echoed as x-transactionid; carried in RequestContext)
        // Resolved per request (the JWT is identity-only — role/account are NOT trusted from claims):
        accountId? : string;                   // the acting account the caller is operating in
        role?      : string;                   // the caller's resolved Access role within that account
        apiKey?    : boolean;                  // true when authenticated via a developer API key (rup_<keyId>.<secret>) —
                                               // userId/accountId/role are ADOPTED from the key; membership is NOT re-resolved
    }


}

export default RestfulEndpoint;