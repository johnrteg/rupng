//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";

//
// Serve the published developer API's OpenAPI 3.1 document, generated live from the endpoint contracts
// (PublicApi.document). Unauthenticated + PUBLIC so the in-app Scalar docs viewer and external tools
// (readme.io, Postman) can fetch it directly. Always in sync — it's built from the same contracts the
// server runs, never a checked-in copy.
//
export class GetOpenApi extends RestfulEndpoint<{}, undefined, GetOpenApi.Response>
{
    public readonly uri      : string = GetOpenApi.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.GET;
    public readonly access   : Access.Role | undefined = undefined;   // unauthenticated (public spec)
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.PUBLIC;   // edge-reachable + published

    // published-docs metadata (this endpoint is service-prefix-routed, so it's a correct, working example)
    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "getOpenApi",
        summary:     "Get the API specification",
        description: "Returns this API's OpenAPI 3.1 document (JSON), generated live from the endpoints. Unauthenticated.",
        tags:        [ "Meta" ],
        errors:      { 500: "Failed to build the specification" },
    };

    constructor() { super( {} ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return []; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null { return null; }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // the success body is an OpenAPI 3.1 document — a loose object shape (the doc itself is large/dynamic)
    public getResponseSchema(): RestfulEndpoint.Schema | null
    {
        return {
            type: "object",
            required: [ "openapi", "info", "paths" ],
            properties: {
                openapi:    { type: "string", description: "OpenAPI version.", examples: [ "3.1.0" ] },
                info:       { type: "object", description: "Title / version / description." },
                paths:      { type: "object", description: "The documented operations, keyed by path." },
                components: { type: "object", description: "Shared schemas + security schemes." },
            },
        };
    }
}

export namespace GetOpenApi
{
    export const URI : string = apiPath( "app", 1, "/openapi.json" );   // /api/app/v1/openapi.json

    /** The OpenAPI 3.1 document for the published API. */
    export type Response = RestfulEndpoint.OpenApi.Document;

    export enum Error { INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR }
}

export default GetOpenApi;
