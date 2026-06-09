//
// DynamoDB facade — item CRUD + query over the ergonomic DocumentClient (plain JS objects,
// no AttributeValue marshalling), keyed by cloud-spec LOGICAL table keys.
//
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, PutCommand, DeleteCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import type { QueryCommandInput, GetCommandOutput, QueryCommandOutput } from "@aws-sdk/lib-dynamodb";
import type { CloudResolver, ResourceKey } from "@repo/cloud-spec";
import { ResultUtils } from "@repo/common";
import type { Type } from "@repo/common";
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

    ///////////////////////////////////////////////////////////////////////////////////////////
    /** @param cloud the owning service's resolver — maps logical table keys to physical names. */
    constructor( private readonly cloud : CloudResolver ) {}

    ///////////////////////////////////////////////////////////////////////////////////////////
    /**
     * The raw DynamoDB **DocumentClient** — escape hatch for batch/transaction/scan/paginated
     * operations. Created lazily; configured to drop `undefined` values on write.
     */
    get client() : DynamoDBDocumentClient
    {
        return this._doc ??= DynamoDBDocumentClient.from( ClientUtils.createClient( DynamoDBClient ), { marshallOptions: { removeUndefinedValues: true } } );
    }

    ///////////////////////////////////////////////////////////////////////////////////////////
    /** Resolve a cloud-spec logical table key (e.g. `"contacts"`) to its physical table name. */
    table( key : ResourceKey ) : string { return this.cloud.tableName( key ); }

    ///////////////////////////////////////////////////////////////////////////////////////////
    /**
     * Get a single item by its primary key.
     *
     * **Consistency:** defaults to an **eventually-consistent** read — immediately after a write the
     * item may not yet be visible. Pass `opts.consistent` for a **strongly-consistent** read
     * (read-after-write guaranteed; ~2× read cost, single-region, base table only — *not* a GSI).
     *
     * @param tableKey logical table key.
     * @param key      the full primary key — `{ partitionKey, sortKey? }`.
     * @param opts     `consistent` → strongly-consistent read (default `false`).
     * @returns the item (typed as `T`), or `undefined` if not found.
     */
    get<T>( tableKey : ResourceKey, key : Record<string, unknown>, opts : Dynamo.ReadOptions = {} ) : Promise<Type.Result<T | undefined>>
    {
        return ResultUtils.from( async () : Promise<T | undefined> =>
        {
            const result : GetCommandOutput = await this.client.send( new GetCommand( { TableName: this.table( tableKey ), Key: key, ConsistentRead: opts.consistent } ) );
            return result.Item as T | undefined;
        } );
    }

    ///////////////////////////////////////////////////////////////////////////////////////////
    /** Put (create or overwrite) an item. For conditional writes use `.client` with a `ConditionExpression`. */
    put( tableKey : ResourceKey, item : Record<string, unknown> ) : Promise<Type.Result<void>>
    {
        return ResultUtils.from( async () : Promise<void> =>
        {
            await this.client.send( new PutCommand( { TableName: this.table( tableKey ), Item: item } ) );
        } );
    }

    ///////////////////////////////////////////////////////////////////////////////////////////
    /** Delete an item by its primary key (idempotent). */
    remove( tableKey : ResourceKey, key : Record<string, unknown> ) : Promise<Type.Result<void>>
    {
        return ResultUtils.from( async () : Promise<void> =>
        {
            await this.client.send( new DeleteCommand( { TableName: this.table( tableKey ), Key: key } ) );
        } );
    }

    ///////////////////////////////////////////////////////////////////////////////////////////
    /**
     * Query a partition (always prefer this over a scan — it reads only the matched partition).
     * Supply `KeyConditionExpression` + `ExpressionAttributeValues` (and optionally `IndexName`
     * for a GSI) via `input`. Returns one page; for large result sets paginate via `.client`.
     *
     * **Consistency:** eventually-consistent by default; set `ConsistentRead: true` in `input` for a
     * strongly-consistent read — but **only on the base table**: a GSI query is *always* eventually
     * consistent and rejects `ConsistentRead`.
     *
     * @param tableKey logical table key.
     * @param input    the Query parameters minus `TableName`.
     */
    query<T>( tableKey : ResourceKey, input : Omit<QueryCommandInput, "TableName"> ) : Promise<Type.Result<Array<T>>>
    {
        return ResultUtils.from( async () : Promise<Array<T>> =>
        {
            const result : QueryCommandOutput = await this.client.send( new QueryCommand( { ...input, TableName: this.table( tableKey ) } ) );
            return ( result.Items ?? [] ) as Array<T>;
        } );
    }
}

export namespace Dynamo
{
    /** Read tuning for {@link Dynamo.get}. */
    export interface ReadOptions
    {
        /** Strongly-consistent read (read-after-write). Default `false` (eventually consistent).
         *  ~2× read cost, single-region, **base table only** — not valid on a GSI. */
        consistent? : boolean;
    }
}
