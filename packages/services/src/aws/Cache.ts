//
// Cache facade — Redis (ElastiCache) via ioredis. NOT an AWS SDK client (Redis speaks its own
// protocol), keyed by a cloud-spec LOGICAL cache key (CloudResolver -> endpoint).
//
import Redis from "ioredis";
import type { CloudResolver, ResourceKey } from "@repo/cloud-spec";
import { ResultUtils } from "@repo/common";
import type { Type } from "@repo/common";

/**
 * Cache facade — Redis over `ioredis`, against the ElastiCache endpoint resolved from a
 * cloud-spec LOGICAL cache key (default `"cache"`).
 *
 * **Use for** ephemeral, fast-access data: caching, rate-limit counters, sessions, locks,
 * pub/sub. Never the source of truth — anything durable belongs in DynamoDB/RDS. The
 * connection is created lazily on first use. Reach through `.client` for pipelines, Lua,
 * pub/sub, or any command not wrapped here.
 *
 * Note: ElastiCache **Serverless** requires TLS — pass a `rediss://` endpoint (the `/cloud`
 * build injects the right scheme); plaintext `redis://`/`host:port` is for local.
 */
export class Cache
{
    private _redis? : Redis;
    private readonly namespace : string;    // service prefix for keys (collision-safe on a shared cluster)
    private readonly version   : string;    // key-schema version segment

    ///////////////////////////////////////////////////////////////////////////////////////
    /**
     * @param cloud    the owning service's resolver — maps the logical cache key to an endpoint.
     * @param cacheKey logical cache key (default `"cache"`).
     * @param keyspace overrides for the key prefix — `namespace` (default `SERVICE_NAME`) + `version`
     *                 (default `"v1"`). See {@link Cache.key} and `aws/SPECS.md` → Redis key naming.
     */
    constructor(
        private readonly cloud : CloudResolver,
        private readonly cacheKey : ResourceKey = "cache",
        keyspace : Cache.Keyspace = {},
    )
    {
        this.namespace = keyspace.namespace ?? process.env.SERVICE_NAME ?? "service";
        this.version   = keyspace.version   ?? "v1";
    }

    ///////////////////////////////////////////////////////////////////////////////////////
    /** The raw `ioredis` client — escape hatch (pipelines, Lua, pub/sub, …). Connects lazily. */
    get client() : Redis
    {
        if( this._redis === undefined )
        {
            const endpoint : string = this.cloud.cacheEndpoint( this.cacheKey );
            this._redis = endpoint.includes( "://" )
                ? new Redis( endpoint, { maxRetriesPerRequest: 3 } )
                : new Redis( { host: endpoint.split( ":" )[ 0 ], port: Number( endpoint.split( ":" )[ 1 ] ) || 6379, maxRetriesPerRequest: 3 } );
        }
        return this._redis;
    }

    ///////////////////////////////////////////////////////////////////////////////////////
    /**
     * Build a key to the **platform standard** — callers pass structured {@link Cache.KeyParts} rather
     * than hand-concatenating, so the format lives in **one place** and can evolve later. Produces:
     *
     *   `<namespace>:<version>:<purpose>:[acct:<account>:]<entity>:<id>[:<field>]`
     *
     * e.g. `key({ purpose: Cache.Purpose.CACHE, accountId, entity: "contact", id })`
     *      → `"texting:v1:cache:acct:<accountId>:contact:<id>"`.
     *
     * Set `hashTagAccount` to wrap the account in `{…}` so an account's keys co-locate on one shard
     * (cluster mode — needed for multi-key Lua/MULTI), e.g. rate-limit buckets:
     *      `key({ purpose: Cache.Purpose.RATE, accountId, hashTagAccount: true, entity: "min", id: window })`
     *      → `"texting:v1:rl:{acct:<accountId>}:min:<window>"`.
     *
     * {@link get}/{@link set}/{@link del} also accept {@link Cache.KeyParts} directly (they call this).
     */
    key( parts : Cache.KeyParts ) : string
    {
        const segments : Array<string> = [ this.namespace, this.version, parts.purpose ];
        if( parts.accountId !== undefined )
            segments.push( parts.hashTagAccount ? `{acct:${parts.accountId}}` : `acct:${parts.accountId}` );
        segments.push( parts.entity, parts.id );
        if( parts.field !== undefined ) segments.push( parts.field );
        return segments.join( ":" );
    }

    /** Normalize a {@link Cache.Key} (raw string or {@link Cache.KeyParts}) to the physical key string. */
    private resolve( key : Cache.Key ) : string { return typeof key === "string" ? key : this.key( key ); }

    ///////////////////////////////////////////////////////////////////////////////////////
    /**
     * Get a value, **`JSON.parse`d** and typed as `T` (or `null` if absent). The facade owns
     * serialization — callers don't parse. A stored value that fails to parse yields `ok: false`
     * (non-throwing). Key may be a built string or {@link Cache.KeyParts}.
     * @typeParam T the expected shape (defaults to {@link Type.Json}).
     */
    get<T = Type.Json>( key : Cache.Key ) : Promise<Type.Result<T | null>>
    {
        return ResultUtils.from( async () : Promise<T | null> =>
        {
            const raw : string | null = await this.client.get( this.resolve( key ) );
            return raw === null ? null : ( JSON.parse( raw ) as T );
        } );
    }

    ///////////////////////////////////////////////////////////////////////////////////////
    /**
     * Set a value, **`JSON.stringify`d** by the facade (pass the object/value, not a string),
     * optionally with a TTL in seconds. Key may be a built string or {@link Cache.KeyParts}.
     */
    set( key : Cache.Key, value : Type.Json, ttlSec? : Type.Seconds ) : Promise<Type.Result<void>>
    {
        return ResultUtils.from( async () : Promise<void> =>
        {
            const physical : string = this.resolve( key );
            const payload  : string = JSON.stringify( value );
            if( ttlSec !== undefined ) await this.client.set( physical, payload, "EX", ttlSec );
            else                       await this.client.set( physical, payload );
        } );
    }

    ///////////////////////////////////////////////////////////////////////////////////////
    /** Delete a key (idempotent). Key may be a built string or {@link Cache.KeyParts}. */
    del( key : Cache.Key ) : Promise<Type.Result<void>> { return ResultUtils.from( async () : Promise<void> => { await this.client.del( this.resolve( key ) ); } ); }

    ///////////////////////////////////////////////////////////////////////////////////////
    /** Close the connection (call during graceful shutdown). */
    async disconnect() : Promise<void> { if( this._redis !== undefined ) await this._redis.quit(); }
}

export namespace Cache
{
    /** Standard key purposes (the `<purpose>` segment) — keep uses scannable + collision-free. */
    export enum Purpose
    {
        CACHE   = "cache",      // cached read-through data
        SESSION = "sess",       // sessions
        LOCK    = "lock",       // distributed locks
        RATE    = "rl",         // rate-limit counters / token buckets
        INDEX   = "idx",        // secondary indexes / membership sets
    }

    /**
     * Structured key per the platform standard (see {@link Cache.key}). `namespace` + `version` come
     * from the facade; you supply the rest. Segment values should be lowercase, contain **no `:`**, and
     * **no PII** (keys surface in logs/SLOWLOG) — use opaque ids.
     */
    export interface KeyParts
    {
        purpose         : Purpose;          // the <purpose> segment
        entity          : string;           // the thing, e.g. "contact"
        id              : string;           // its opaque id (uuid / internal id)
        accountId?      : string;           // tenant scope -> "acct:<accountId>"
        field?          : string;           // optional trailing field/sub-key
        hashTagAccount? : boolean;          // wrap account in {…} for cluster co-location (default false)
    }

    /** A key argument to {@link Cache.get}/{@link Cache.set}/{@link Cache.del}: a built string or parts. */
    export type Key = string | KeyParts;

    /** Key-prefix overrides for the {@link Cache} constructor. */
    export interface Keyspace
    {
        namespace? : string;    // service prefix (default `SERVICE_NAME`)
        version?   : string;    // key-schema version (default `"v1"`)
    }
}
