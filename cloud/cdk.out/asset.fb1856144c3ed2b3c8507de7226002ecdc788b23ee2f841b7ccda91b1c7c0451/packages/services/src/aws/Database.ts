//
// Database facade — PostgreSQL (RDS / Aurora) via `pg`, through the RDS PROXY endpoint, keyed
// by a cloud-manifest LOGICAL database key. Routes by access mode to the writer or reader endpoint.
//
import { Pool } from "pg";
import type { PoolClient, QueryResult, QueryResultRow } from "pg";
import { Signer } from "@aws-sdk/rds-signer";
import { ResourceKind } from "@repo/cloud-manifest";
import type { CloudResolver, ResourceKey } from "@repo/cloud-manifest";
import { ResultUtils } from "@repo/common";
import type { Type } from "@repo/common";

/**
 * PostgreSQL facade (RDS / Aurora) over `pg`, against the **RDS Proxy** endpoint resolved from a
 * cloud-manifest LOGICAL database key (default `"main"`).
 *
 * **Default to DynamoDB instead** for most service data — it runs identically local↔cloud with
 * no proxy/pooling/IAM-user setup. Use this facade only for a genuinely **relational** workload
 * (transactions + ad-hoc queries/reporting, e.g. billing); for query-heavy reads over DynamoDB
 * use OpenSearch/analytics. **Locally** this needs a `postgres` side-container (not LocalStack
 * RDS — its Proxy emulation is unreliable); the local branch below uses `DB_PASSWORD` + no TLS.
 *
 * **Always goes through RDS Proxy** (the `/cloud` build injects the proxy endpoint as the
 * database URL): the proxy pools + multiplexes connections server-side, which is essential
 * under Lambda/Fargate where many concurrent invocations would otherwise exhaust DB
 * connections. Keep the *client* pool small ({@link Database.Options.max}); the proxy does the
 * heavy lifting.
 *
 * **Read/write routing** ({@link Database.Access}): `READ` uses the **reader** proxy endpoint
 * (Aurora replicas — offloads the writer for SELECT/reporting); `WRITE`/`READ_WRITE` use the
 * **writer**. If no reader endpoint is injected (single-instance DB), `READ` transparently
 * falls back to the writer.
 *
 * **Auth:** in the cloud, **IAM auth** through the proxy (a short-lived token, no static
 * credentials); locally, `DB_PASSWORD`. Reach through {@link pool} / a `PoolClient` for cursors,
 * COPY, LISTEN/NOTIFY, or anything not wrapped.
 */
export class Database
{
    private _writer? : Pool;
    private _reader? : Pool;

    /**
     * @param cloud the owning service's resolver — maps the logical db key to proxy endpoints.
     * @param dbKey logical database key (default `"main"`).
     * @param opts  database name / user / pool size / ssl / explicit password — see {@link Database.Options}.
     */
    constructor(
        private readonly cloud : CloudResolver,
        private readonly dbKey : ResourceKey = "main",
        private readonly opts  : Database.Options = {},
    ) {}

    /** Build a pg Pool for a proxy endpoint: IAM-auth token (cloud) or DB_PASSWORD (local). */
    private build( endpoint : string ) : Pool
    {
        const [ host, portStr ] : Array<string> = endpoint.split( ":" );
        const port : number  = Number( portStr ) || 5432;
        const user : string  = this.opts.user ?? process.env.DB_USER ?? "postgres";
        const local : boolean = process.env.AWS_ENDPOINT_URL !== undefined && process.env.AWS_ENDPOINT_URL !== "";

        // Cloud: IAM auth via RDS Proxy — pg calls this per new connection, refreshing the ~15-min
        // token automatically. Local: a plain password.
        const password : Database.Options[ "password" ] = this.opts.password
            ?? ( local
                ? ( process.env.DB_PASSWORD ?? "postgres" )
                : ( () => new Signer( { hostname: host, port, username: user, region: process.env.AWS_REGION ?? "us-east-1" } ).getAuthToken() ) );

        return new Pool( {
            host,
            port,
            user,
            database : this.opts.database ?? process.env.DB_NAME,
            password,
            // RDS Proxy requires TLS; provide the RDS CA via opts.ssl.ca in strict environments.
            ssl      : local ? false : ( this.opts.ssl ?? { rejectUnauthorized: true } ),
            max      : this.opts.max ?? 5,
        } );
    }

    private writer() : Pool { return this._writer ??= this.build( this.cloud.databaseUrl( this.dbKey ) ); }

    private reader() : Pool
    {
        if( this._reader === undefined )
        {
            const ro : string | undefined = this.cloud.lookup( ResourceKind.DATABASE, `${this.dbKey}-reader` );
            this._reader = ro ? this.build( ro ) : this.writer();   // fall back to writer if no reader endpoint
        }
        return this._reader;
    }

    private poolFor( access : Database.Access ) : Pool
    {
        return access === Database.Access.READ ? this.reader() : this.writer();
    }

    /** The pg `Pool` for an access mode — escape hatch (e.g. `pool().connect()` for a manual transaction). */
    pool( access : Database.Access = Database.Access.READ_WRITE ) : Pool { return this.poolFor( access ); }

    /**
     * Run a parameterized query and return the rows. Use `$1, $2, …` placeholders with `params`
     * (never string-interpolate — SQL injection).
     * @param access routing — `READ` hits the reader endpoint; default `READ_WRITE` hits the writer.
     */
    query<T extends QueryResultRow>( sql : string, params : Array<unknown> = [], access : Database.Access = Database.Access.READ_WRITE ) : Promise<Type.Result<Array<T>>>
    {
        return ResultUtils.from( async () : Promise<Array<T>> =>
        {
            const result : QueryResult<T> = await this.poolFor( access ).query<T>( sql, params );
            return result.rows;
        } );
    }

    /**
     * Run `fn` inside a transaction on the **writer** (`BEGIN`/`COMMIT`, `ROLLBACK` on throw).
     * The provided `PoolClient` is released automatically.
     */
    tx<T>( fn : ( client : PoolClient ) => Promise<T> ) : Promise<Type.Result<T>>
    {
        return ResultUtils.from( async () : Promise<T> =>
        {
            const client : PoolClient = await this.writer().connect();
            try
            {
                await client.query( "BEGIN" );
                const result : T = await fn( client );
                await client.query( "COMMIT" );
                return result;
            }
            catch ( error )
            {
                await client.query( "ROLLBACK" );
                throw error;   // rethrow → captured by ResultUtils.from as { ok: false }
            }
            finally
            {
                client.release();
            }
        } );
    }

    /** Close the pool(s) — call during graceful shutdown. */
    async end() : Promise<void>
    {
        await this._writer?.end();
        if( this._reader !== undefined && this._reader !== this._writer ) await this._reader.end();
    }
}

export namespace Database
{
    /** Which RDS Proxy endpoint a query uses. */
    export enum Access
    {
        READ       = "read",        // reader endpoint (Aurora replicas) — SELECT/reporting; offloads the writer
        WRITE      = "write",       // writer endpoint — INSERT/UPDATE/DELETE/DDL
        READ_WRITE = "readwrite",   // writer endpoint — mixed read+write in one unit (default, safe)
    }

    /** Connection options; sensible defaults are read from `DB_*` env when omitted. */
    export interface Options
    {
        database? : string;
        user?     : string;
        password? : string | ( () => string | Promise<string> );   // omit in cloud → IAM auth
        ssl?      : boolean | { rejectUnauthorized : boolean; ca? : string };
        max?      : number;         // client pool size — keep small; RDS Proxy multiplexes server-side
    }
}
