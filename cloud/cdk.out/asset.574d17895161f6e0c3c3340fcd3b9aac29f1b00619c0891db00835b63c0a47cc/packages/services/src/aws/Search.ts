//
// OpenSearch facade — index/search over `@opensearch-project/opensearch` (NOT an AWS SDK
// client), against the endpoint resolved from a cloud-manifest LOGICAL search key. Bound to one
// cluster; methods operate on indices within it.
//
import { Client } from "@opensearch-project/opensearch";
import type { ApiResponse } from "@opensearch-project/opensearch";
import { AwsSigv4Signer } from "@opensearch-project/opensearch/aws";
import { fromNodeProviderChain } from "@aws-sdk/credential-providers";
import type { CloudResolver, ResourceKey } from "@repo/cloud-manifest";
import { ResultUtils } from "@repo/common";
import type { Type } from "@repo/common";

/**
 * OpenSearch facade — full-text search + analytics over `@opensearch-project/opensearch`,
 * against the endpoint resolved from a cloud-manifest LOGICAL search key (default `"search"`).
 *
 * **Use for** search and log/analytics queries — never as the system of record (index
 * *projections* of data owned by DynamoDB/RDS). In the cloud, requests are SigV4-signed with
 * the service's role; locally (LocalStack) the client connects unsigned. Reach through
 * `.client` for bulk, aggregations, mappings, or any API not wrapped here.
 */
export class Search
{
    private _client? : Client;

    ///////////////////////////////////////////////////////////////////////////////////////////
    /**
     * @param cloud     the owning service's resolver — maps the logical search key to an endpoint.
     * @param searchKey logical search key (default `"search"`).
     * @param service   SigV4 signing service — see {@link Search.Service} (default `SERVERLESS`).
     */
    constructor(
        private readonly cloud : CloudResolver,
        private readonly searchKey : ResourceKey = "search",
        private readonly service : Search.Service = Search.Service.SERVERLESS,
    ) {}

    ///////////////////////////////////////////////////////////////////////////////////////////
    /** The raw OpenSearch `Client` — escape hatch (bulk, aggregations, mappings, …). Lazy + cached. */
    get client() : Client
    {
        if( this._client === undefined )
        {
            const endpoint : string = this.cloud.searchEndpoint( this.searchKey );
            const node : string = endpoint.includes( "://" ) ? endpoint : `https://${endpoint}`;

            this._client = process.env.AWS_ENDPOINT_URL
                ? new Client( { node } )                                       // local (LocalStack) — unsigned
                : new Client( {
                    ...AwsSigv4Signer( {
                        region         : process.env.AWS_REGION ?? "us-east-1",
                        service        : this.service,
                        getCredentials : () => fromNodeProviderChain()(),
                    } ),
                    node,
                } );
        }
        return this._client;
    }

    ///////////////////////////////////////////////////////////////////////////////////////////
    /** Index (create or replace) a document by id; refreshes so it's immediately searchable. */
    index( indexName : string, id : string, document : Record<string, unknown> ) : Promise<Type.Result<void>>
    {
        return ResultUtils.from( async () : Promise<void> =>
        {
            await this.client.index( { index: indexName, id, body: document, refresh: true } );
        } );
    }

    ///////////////////////////////////////////////////////////////////////////////////////////
    /**
     * Run a query and return the matching documents (`_source`). Pass an OpenSearch query DSL
     * object (e.g. `{ match: { name: "ada" } }`). For paging/aggregations/sorting use `.client`.
     * @typeParam T the document shape.
     */
    search<T>( indexName : string, query : Record<string, unknown> ) : Promise<Type.Result<Array<T>>>
    {
        return ResultUtils.from( async () : Promise<Array<T>> =>
        {
            const response : ApiResponse = await this.client.search( { index: indexName, body: { query } } );
            // OpenSearch's response body is loosely typed; narrow to the hits we care about.
            const hits : Array<{ _source? : T }> = ( response.body as { hits?: { hits?: Array<{ _source? : T }> } } ).hits?.hits ?? [];
            return hits.map( ( hit ) => hit._source as T );
        } );
    }

    ///////////////////////////////////////////////////////////////////////////////////////////
    /** Get one document by id; `ok` with `undefined` data if it doesn't exist (404). */
    get<T>( indexName : string, id : string ) : Promise<Type.Result<T | undefined>>
    {
        return ResultUtils.from( async () : Promise<T | undefined> =>
        {
            try
            {
                const response : ApiResponse = await this.client.get( { index: indexName, id } );
                return response.body._source as T;
            }
            catch ( cause : unknown )
            {
                // a genuine "not found" is data (undefined), not an error; anything else propagates.
                const status : number | undefined = ( cause as { statusCode? : number; meta? : { statusCode? : number } } ).statusCode
                    ?? ( cause as { meta? : { statusCode? : number } } ).meta?.statusCode;
                if( status === 404 ) return undefined;
                throw cause;
            }
        } );
    }

    ///////////////////////////////////////////////////////////////////////////////////////////
    /** Delete a document by id. */
    remove( indexName : string, id : string ) : Promise<Type.Result<void>>
    {
        return ResultUtils.from( async () : Promise<void> =>
        {
            await this.client.delete( { index: indexName, id } );
        } );
    }
}

export namespace Search
{
    /**
     * The SigV4 signing service name — differs by OpenSearch flavor (must match the cluster you
     * provisioned in cloud-manifest):
     * - **`SERVERLESS`** (`"aoss"`) — OpenSearch **Serverless** collection (the platform default).
     * - **`DOMAIN`** (`"es"`) — a managed OpenSearch **domain** (node-based).
     */
    export enum Service
    {
        SERVERLESS = "aoss",
        DOMAIN     = "es",
    }
}
