//
// Cache facade — Redis (ElastiCache) via ioredis. NOT an AWS SDK client (Redis speaks its own
// protocol), keyed by a cloud-spec LOGICAL cache key (CloudResolver -> endpoint).
//
import Redis from "ioredis";
import type { CloudResolver, ResourceKey } from "@repo/cloud-spec";

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

    ///////////////////////////////////////////////////////////////////////////////////////
    /**
     * @param cloud    the owning service's resolver — maps the logical cache key to an endpoint.
     * @param cacheKey logical cache key (default `"cache"`).
     */
    constructor( private readonly cloud : CloudResolver, private readonly cacheKey : ResourceKey = "cache" ) {}

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
    /** Get a string value (or `null` if absent). */
    get( key : string ) : Promise<string | null> { return this.client.get( key ); }

    ///////////////////////////////////////////////////////////////////////////////////////
    /** Set a string value, optionally with a TTL in seconds. */
    async set( key : string, value : string, ttlSec? : number ) : Promise<void>
    {
        if( ttlSec !== undefined ) await this.client.set( key, value, "EX", ttlSec );
        else                       await this.client.set( key, value );
    }

    ///////////////////////////////////////////////////////////////////////////////////////
    /** Delete a key (idempotent). */
    async del( key : string ) : Promise<void> { await this.client.del( key ); }

    ///////////////////////////////////////////////////////////////////////////////////////
    /** Close the connection (call during graceful shutdown). */
    async disconnect() : Promise<void> { if( this._redis !== undefined ) await this._redis.quit(); }
}
