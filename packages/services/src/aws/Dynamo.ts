//
// DynamoDB facade — item CRUD + query over the ergonomic DocumentClient (plain JS objects,
// no AttributeValue marshalling), keyed by cloud-spec LOGICAL table keys.
//
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, PutCommand, DeleteCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import type { QueryCommandInput, GetCommandOutput, QueryCommandOutput } from "@aws-sdk/lib-dynamodb";
import type { CloudResolver, ResourceKey } from "@repo/cloud-spec";
import { ClientUtils } from "./ClientUtils";

/**
 * DynamoDB facade — the routine single-table operations over `@aws-sdk/lib-dynamodb`'s
 * **DocumentClient** (work in plain JS objects; no `{ S: "…" }` marshalling), addressed by
 * cloud-spec LOGICAL table keys (e.g. `"contacts"`).
 *
 * This is the canonical "specific service extends the base" facade — wire it on a concrete
 * `Service`/`Job` (it's not on the base `Application`):
 * ```ts
 * class ContactService extends Service {
 *     private _dynamo? : Dynamo;
 *     protected get dynamo() : Dynamo { return this._dynamo ??= new Dynamo( this.cloud ); }
 * }
 * ```
 * For batch writes, transactions, scans, or paginated queries, reach through `.client`.
 */
export class Dynamo
{
    private _doc? : DynamoDBDocumentClient;

    /** @param cloud the owning service's resolver — maps logical table keys to physical names. */
    constructor( private readonly cloud : CloudResolver ) {}

    /**
     * The raw DynamoDB **DocumentClient** — escape hatch for batch/transaction/scan/paginated
     * operations. Created lazily; configured to drop `undefined` values on write.
     */
    get client() : DynamoDBDocumentClient
    {
        return this._doc ??= DynamoDBDocumentClient.from( ClientUtils.createClient( DynamoDBClient ), { marshallOptions: { removeUndefinedValues: true } } );
    }

    /** Resolve a cloud-spec logical table key (e.g. `"contacts"`) to its physical table name. */
    table( key : ResourceKey ) : string { return this.cloud.tableName( key ); }

    /**
     * Get a single item by its primary key.
     * @param tableKey logical table key.
     * @param key      the full primary key — `{ partitionKey, sortKey? }`.
     * @returns the item (typed as `T`), or `undefined` if not found.
     */
    async get<T>( tableKey : ResourceKey, key : Record<string, unknown> ) : Promise<T | undefined>
    {
        const result : GetCommandOutput = await this.client.send( new GetCommand( { TableName: this.table( tableKey ), Key: key } ) );
        return result.Item as T | undefined;
    }

    /** Put (create or overwrite) an item. For conditional writes use `.client` with a `ConditionExpression`. */
    async put( tableKey : ResourceKey, item : Record<string, unknown> ) : Promise<void>
    {
        await this.client.send( new PutCommand( { TableName: this.table( tableKey ), Item: item } ) );
    }

    /** Delete an item by its primary key (idempotent). */
    async remove( tableKey : ResourceKey, key : Record<string, unknown> ) : Promise<void>
    {
        await this.client.send( new DeleteCommand( { TableName: this.table( tableKey ), Key: key } ) );
    }

    /**
     * Query a partition (always prefer this over a scan — it reads only the matched partition).
     * Supply `KeyConditionExpression` + `ExpressionAttributeValues` (and optionally `IndexName`
     * for a GSI) via `input`. Returns one page; for large result sets paginate via `.client`.
     * @param tableKey logical table key.
     * @param input    the Query parameters minus `TableName`.
     */
    async query<T>( tableKey : ResourceKey, input : Omit<QueryCommandInput, "TableName"> ) : Promise<Array<T>>
    {
        const result : QueryCommandOutput = await this.client.send( new QueryCommand( { ...input, TableName: this.table( tableKey ) } ) );
        return ( result.Items ?? [] ) as Array<T>;
    }
}
