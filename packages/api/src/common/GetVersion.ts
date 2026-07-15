//
import { NetworkUtils } from "@repo/common";
import { RestfulEndpoint, Access } from "@repo/endpoint";

/*
    A tiny, unauthenticated endpoint that reports the running service's id + version. Audience PUBLIC
    so it is reachable at the API Gateway edge (exposure derives from audience) — the deploy console
    discovers each service's gateway and reads /version to show what's actually live per environment.

    client:
    const endpt : GetVersion = new GetVersion( {} );
    const response = await appdata.server.fetch( endpt );
    if( response.ok ) { const reply : GetVersion.Response = response.data; }
*/
export class GetVersion extends RestfulEndpoint<GetVersion.Query, undefined, GetVersion.Response>
{
    public readonly uri      : string = "/version";
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.GET;
    public readonly access   : Access.Role | undefined = undefined;   // non-authenticated
    public readonly timeout  : number | undefined = undefined;        // default
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.PUBLIC;   // edge-reachable + published

    // published-docs metadata (summary/tags feed the OpenAPI operation) — this endpoint is the reference
    // example of a fully self-documented PUBLIC contract: docs + a getResponseSchema() with per-field docs.
    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "getVersion",
        summary:     "Get service version",
        description: "Returns the running service's canonical id and its deployed version. Unauthenticated.",
        tags:        [ "Meta" ],
    };

    ////////////////////////////////////////////////////////////////////////////////////////////
    constructor( query? : GetVersion.Query )
    {
        super( query ?? {}, undefined );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    public getMappings(): Array<RestfulEndpoint.FieldMap>
    {
        return [];
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    public getQuerySchema(): RestfulEndpoint.SchemaFor<GetVersion.Query> | null
    {
        return null;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    public getBodySchema(): RestfulEndpoint.Schema | null
    {
        return null;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // success-response shape (JSON Schema == OpenAPI 3.1); per-field `description`/`examples` render in the docs
    public getResponseSchema(): RestfulEndpoint.Schema | null
    {
        return {
            type: "object",
            required: [ "service", "version" ],
            properties: {
                service: { type: "string", description: "Canonical service id.",           examples: [ "app" ] },
                version: { type: "string", description: "Deployed package.json version.",   examples: [ "1.4.2" ] },
            },
        };
    }
}


export namespace GetVersion
{
    export interface Query extends RestfulEndpoint.NonAuthRequest
    {
    }

    export interface Response
    {
        /** Canonical service id (e.g. "app"). */
        service : string;
        /** package.json version of the running service. */
        version : string;
    }

    // possible error type
    export enum Error
    {
        BAD_REQUEST = NetworkUtils.Status.BAD_REQUEST,
        INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR,
    }

}

export default GetVersion;
