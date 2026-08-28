//
// DynamoDB facade — item CRUD + query over the ergonomic DocumentClient (plain JS objects,
// no AttributeValue marshalling), keyed by cloud-manifest LOGICAL table keys.
//
import { DynamoDBClient, DescribeTableCommand } from "@aws-sdk/client-dynamodb";
import type { DescribeTableCommandOutput, TableDescription } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, PutCommand, DeleteCommand, QueryCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import type { QueryCommandInput, GetCommandOutput, QueryCommandOutput, UpdateCommandOutput } from "@aws-sdk/lib-dynamodb";
import type { CloudResolver, ResourceKey } from "@repo/cloud-manifest";
import { ResultUtils } from "@repo/common";
import type { Type } from "@repo/common";
import { ClientUtils } from "./ClientUtils";

/**
 * DynamoDB facade — the routine single-table operations over `@aws-sdk/lib-dynamodb`'s
 * **DocumentClient** (work in plain JS objects; no `{ S: "…" }` marshalling), addressed by
 * cloud-manifest LOGICAL table keys (e.g. `"contacts"`).
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
    private _raw? : DynamoDBClient;

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
    /** Resolve a cloud-manifest logical table key (e.g. `"contacts"`) to its physical table name. */
    table( key : ResourceKey ) : string { return this.cloud.tableName( key ); }

    ///////////////////////////////////////////////////////////////////////////////////////////
    /**
     * Describe a table by its EXPLICIT physical name (not a logical key) — the escape hatch for
     * inspecting a table this service doesn't own (e.g. `monitor` reading item count/size/status
     * for a dashboard widget). Item count and table size are CloudWatch-derived and updated by
     * AWS roughly every 6 hours — a coarse signal, fine for a health tile, not a live counter.
     */
    describeTable( tableName : string ) : Promise<Type.Result<TableDescription | undefined>>
    {
        return ResultUtils.from( async () : Promise<TableDescription | undefined> =>
        {
            this._raw ??= ClientUtils.createClient( DynamoDBClient );
            const result : DescribeTableCommandOutput = await this._raw.send( new DescribeTableCommand( { TableName: tableName } ) );
            return result.Table;
        } );
    }

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
    /**
     * Atomically increment a numeric counter attribute and return its NEW value — the primitive for
     * gap-tolerant, never-reused sequence ids (e.g. a per-account "campaign #"). Uses DynamoDB's atomic
     * `ADD`, which treats a missing item/attribute as `0` and applies the delta server-side in one write, so
     * concurrent callers each get a DISTINCT value with no read-modify-write race (the first call on a fresh
     * key returns `1`). The counter lives independently of any entity row, so deleting/purging entities never
     * rolls it back — a consumed number is never handed out again.
     *
     * @param tableKey  logical table key of the counters table.
     * @param key       the counter's full primary key (e.g. `{ accountId, kind }`).
     * @param attribute the numeric attribute to bump (e.g. `"n"`).
     * @param by        the step to add (default `1`).
     * @returns the attribute's value AFTER the increment.
     */
    increment( tableKey : ResourceKey, key : Record<string, unknown>, attribute : string, by : number = 1 ) : Promise<Type.Result<number>>
    {
        return ResultUtils.from( async () : Promise<number> =>
        {
            // ADD initializes a missing attribute to 0 then adds `by`; UPDATED_NEW returns the post-increment value
            const result : UpdateCommandOutput = await this.client.send( new UpdateCommand( {
                TableName:                 this.table( tableKey ),
                Key:                       key,
                UpdateExpression:          "ADD #attr :by",
                ExpressionAttributeNames:  { "#attr": attribute },
                ExpressionAttributeValues: { ":by": by },
                ReturnValues:              "UPDATED_NEW",
            } ) );
            return Number( ( result.Attributes ?? {} )[ attribute ] );
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

    ///////////////////////////////////////////////////////////////////////////////////////////
    /**
     * Query a table by its EXPLICIT physical name (not a logical key) — the escape hatch for reading a
     * table this service doesn't own (e.g. the authorizer reading another service's membership table for
     * per-request role resolution). Caller resolves the physical name (e.g. via `physicalName(...)`).
     */
    queryName<T>( tableName : string, input : Omit<QueryCommandInput, "TableName"> ) : Promise<Type.Result<Array<T>>>
    {
        return ResultUtils.from( async () : Promise<Array<T>> =>
        {
            const result : QueryCommandOutput = await this.client.send( new QueryCommand( { ...input, TableName: tableName } ) );
            return ( result.Items ?? [] ) as Array<T>;
        } );
    }

    ///////////////////////////////////////////////////////////////////////////////////////////
    /**
     * Query **one page** and surface the paging cursor — the cursor-aware counterpart to {@link query}
     * (which returns only the first page). Returns `{ items, cursor }`; pass `opts.cursor` back on the next
     * call to continue (forward cursor paging — DynamoDB has no offset / "jump to page N").
     *
     * **Sorting / direction:** results are ordered by the queried key's **sort key** — `opts.forward` picks
     * the direction (`true` = ascending, default; `false` = descending, e.g. **newest-first**). To sort *by a
     * field* (typically a `lastModifiedAt` / `createdAt`), query the **GSI** whose sort key is that field via
     * `input.IndexName`, keeping `accountId` as the GSI partition key so the page stays tenant-scoped.
     *
     * **Limit:** `opts.limit` is the page size (items DynamoDB *reads*); a `FilterExpression` is applied
     * AFTER it, so a filtered page may return fewer than `limit` even when more match — keep selective
     * conditions in the key / GSI, not a filter.
     *
     * @typeParam T the item shape.
     * @param tableKey logical table key.
     * @param input    Query params minus `TableName` / `Limit` / `ScanIndexForward` / `ExclusiveStartKey`
     *                 (those come from `opts`) — typically `IndexName` + `KeyConditionExpression` + values.
     * @param opts     `{ limit?, cursor?, forward? }`.
     * @returns `{ items, cursor }` — `cursor` is `undefined` on the last page.
     */
    queryPage<T>(
        tableKey : ResourceKey,
        input    : Omit<QueryCommandInput, "TableName" | "Limit" | "ScanIndexForward" | "ExclusiveStartKey">,
        opts     : Dynamo.PageOptions = {},
    ) : Promise<Type.Result<Dynamo.Page<T>>>
    {
        return ResultUtils.from( async () : Promise<Dynamo.Page<T>> =>
        {
            const result : QueryCommandOutput = await this.client.send( new QueryCommand( {
                ...input,
                TableName         : this.table( tableKey ),
                Limit             : opts.limit,
                ScanIndexForward  : opts.forward ?? true,            // true = ascending (default); false = descending
                ExclusiveStartKey : Dynamo.decodeCursor( opts.cursor ),
            } ) );
            return {
                items  : ( result.Items ?? [] ) as Array<T>,
                cursor : Dynamo.encodeCursor( result.LastEvaluatedKey ),
            };
        } );
    }

    ///////////////////////////////////////////////////////////////////////////////////////////
    /** Encode a `LastEvaluatedKey` (plain key map, DocumentClient) → an opaque base64url cursor string. */
    private static encodeCursor( key : Record<string, any> | undefined ) : string | undefined
    {
        return key ? Buffer.from( JSON.stringify( key ) ).toString( "base64url" ) : undefined;
    }

    ///////////////////////////////////////////////////////////////////////////////////////////
    /** Decode an opaque cursor → an `ExclusiveStartKey`; `undefined` (first page) passes through. */
    private static decodeCursor( cursor : string | undefined ) : Record<string, any> | undefined
    {
        return cursor ? JSON.parse( Buffer.from( cursor, "base64url" ).toString() ) : undefined;
    }
}

export namespace Dynamo
{
    /** Options for {@link Dynamo.queryPage} — page size, continuation cursor, and sort direction. */
    export interface PageOptions
    {
        limit?   : number;     // page size — max items DynamoDB reads (a FilterExpression runs AFTER this)
        cursor?  : string;     // opaque cursor from a prior page's `Page.cursor` (omit for the first page)
        forward? : boolean;    // sort direction by sort key: true = ascending (default), false = descending
    }

    /** One page from {@link Dynamo.queryPage}: the items + an opaque `cursor` for the next page (undefined = last). */
    export interface Page<T>
    {
        items   : Array<T>;
        cursor? : string;
    }

    /** Read tuning for {@link Dynamo.get}. */
    export interface ReadOptions
    {
        /** Strongly-consistent read (read-after-write). Default `false` (eventually consistent).
         *  ~2× read cost, single-region, **base table only** — not valid on a GSI. */
        consistent? : boolean;
    }
}
