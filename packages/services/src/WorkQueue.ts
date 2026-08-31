//
// WorkQueue — the shared DISPATCH GOVERNOR. A composable member (NOT a base class) that any
// Service / Consumer / Job adds to regulate how work reaches SQS: per-account FAIR-SHARE
// (Weighted Fair Queuing / DRR — no account starves others) and per-downstream RATE limiting
// (token bucket — never oversend to a provider / outside service). The reusable mechanism the
// platform "does a lot" — centralized here so a channel only configures rules; the governor
// owns its own Redis metrics and makes the dispatch decision.
//
// Composition, not inheritance: `this.workQueue = new WorkQueue(cloud, "email", rules)` — exactly
// like canSend() / sanitizeHtml() / audit() and the AWS facades. The execution-shape axis
// (Daemon → {Service, Consumer} / Job) is orthogonal; the long-running coordinator that drives a
// WorkQueue is a `Consumer` (self-driven, event- + timer-woken). See
// packages/services/DISPATCH.md and packages/services/README.md "Shared dispatch governor".
//
// STORAGE split (dispatch gap #8 — DECIDED: hybrid, not Redis-alone/Dynamo-alone; the GSI access
// pattern below is the prototype the gap called for):
//   • CONFIGURATION — DynamoDB (durable, operator-tuned, read-mostly): account limits / weights /
//     priority / suspension. See WorkQueue.QueueConfig · AccountConfig · AccountQueueConfig.
//   • ACTIVITY — Redis (ephemeral, atomic, TTL'd, rebuildable): the per-minute bins, token buckets,
//     the fairness ZSET, in-flight counts, leases — what the governor READS to decide "who's next +
//     how many now". See WorkQueue.ActivityBin · TokenBucketState · FairnessEntry · InFlight · LeaseState.
// The durable JOB store is DynamoDB; SQS carries a job-id POINTER, never the payload (no PII in the
// queue) — dispatching to SQS itself is left to the caller (the per-channel Consumer), since the
// destination queue name / FIFO group shape is channel-specific; WorkQueue hands back `Lease`s the
// caller then sends.
//
// REQUIRED cloud-manifest resources on the ADOPTING service (WorkQueue is a member, not its own
// deployable — the CONSUMING service's CloudManifest must own these):
//   • cache "cache" (or pass a different logical key via a future ctor option) — Redis for ACTIVITY.
//   • table "wq_jobs"               PK `queue` (S) · SK `jobId` (S)
//       GSI "gsi_status_account"    PK `statusAccountPk` (S) · SK `createdAt` (S)
//                                   (`statusAccountPk` = `${queue}#${status}#${accountId}`, an item
//                                   attribute recomputed on every status transition — lets dispatch()
//                                   find "the oldest PENDING job for account X on queue Y" in one query
//                                   without a scan, per DISPATCH.md gap #8's "prototype the GSI access
//                                   pattern early")
//   • table "wq_queue_config"       PK `queue` (S)                     — WorkQueue.QueueConfig rows
//   • table "wq_account_config"     PK `accountId` (S)                 — WorkQueue.AccountConfig rows
//   • table "wq_account_queue_config" PK `accountId` (S) · SK `queue` (S) — WorkQueue.AccountQueueConfig rows
//

import { randomUUID } from "node:crypto";
import { UpdateCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import type { QueryCommandOutput } from "@aws-sdk/lib-dynamodb";
import type { CloudResolver } from "@repo/cloud-manifest";
import type { Type } from "@repo/common";

import { Cache } from "./aws/Cache";
import { Dynamo } from "./aws/Dynamo";
import { Sqs } from "./aws/Sqs";

// the durable DynamoDB row for a governed job — `Job` plus the lifecycle bookkeeping WorkQueue owns
// (status / the derived fairness-GSI partition key / the active lease, if any).
interface JobRow
{
    queue:           string;
    jobId:           Type.ID;
    accountId:       Type.ID;
    status:          WorkQueue.Status;
    statusAccountPk: string;               // `${queue}#${status}#${accountId}` — the gsi_status_account PK
    priority:        number;
    payloadRef:      Type.ID;
    idempotencyKey:  string;
    createdAt:       Type.ISODateTime;
    meta?:           Type.JsonObject;
    leaseId?:        string;
    leaseExpiresAt?: Type.ISODateTime;
    failReason?:     string;
}

export class WorkQueue
{
    private _cache?  : Cache;
    private _dynamo? : Dynamo;
    private _sqs?    : Sqs;

    // logical table keys this governor reads/writes — fixed convention (see the file header for the
    // shape each must be provisioned with on the adopting service's CloudManifest).
    private static readonly TABLE_JOBS                : string = "wq_jobs";
    private static readonly TABLE_QUEUE_CONFIG         : string = "wq_queue_config";
    private static readonly TABLE_ACCOUNT_CONFIG       : string = "wq_account_config";
    private static readonly TABLE_ACCOUNT_QUEUE_CONFIG : string = "wq_account_queue_config";

    // fallback defaults when neither Dynamo config nor constructor `Rules` supply a value.
    private static readonly DEFAULT_WEIGHT        : number = 1;
    private static readonly DEFAULT_PRIORITY      : number = 5;
    private static readonly DEFAULT_BATCH_SIZE    : number = 20;
    private static readonly DEFAULT_LOW_WATER     : number = 100;
    private static readonly DEFAULT_LEASE_SECONDS : number = 120;
    private static readonly BIN_TTL_SECONDS       : number = 60 * 60 * 24 * 2;   // ~2 days of per-minute bins

    ////////////////////////////////////////////////////////////////////////
    /**
     * @param cloud the owning Service/Consumer's resolver (maps logical keys → endpoints).
     * @param queue the logical queue / channel-type this governor paces — `"email"` · `"sms"` ·
     *              `"webhook"` · `"report"` · … (one WorkQueue per channel-type).
     * @param rules per-channel governance — rate caps, account weights, batch size, low-water-mark.
     *              Channel-specific by design (dispatch is channel-specific); fair-share is **opt-in**
     *              per channel — transactional/one-off sends can skip the governor entirely.
     */
    constructor(
        private readonly cloud : CloudResolver,
        private readonly queue : string,
        private readonly rules : WorkQueue.Rules = {},
    )
    {}

    // lazy facades — Redis (counters + fairness ordering) · DynamoDB (durable job store) · SQS (egress)
    private get cache()  : Cache  { return this._cache  ??= new Cache( this.cloud, "cache" ); }
    private get dynamo() : Dynamo { return this._dynamo ??= new Dynamo( this.cloud ); }
    private get sqs()    : Sqs    { return this._sqs    ??= new Sqs( this.cloud ); }

    ///////////////////////////////////////////////////////////////////////////////////////////////////////////////
    // Enqueue a job into the GOVERNED store (DynamoDB, status=pending) + mark the account eligible in the
    // fairness ZSET. The payload is NOT stored here — `job.payloadRef` points at the real record (DB id / S3 key).
    public async enqueue( job : WorkQueue.Job ) : Promise<void>
    {
        // idempotency is keyed on `jobId` (callers should derive a stable jobId — e.g. a hash of
        // idempotencyKey — so a retried enqueue collides here instead of double-enqueuing); a conditional
        // put makes a retry after a crash-before-ack a safe no-op rather than a duplicate job.
        const row : JobRow = {
            queue: this.queue, jobId: job.jobId, accountId: job.accountId, status: WorkQueue.Status.PENDING,
            statusAccountPk: this.statusAccountPk( WorkQueue.Status.PENDING, job.accountId ),
            priority: job.priority, payloadRef: job.payloadRef, idempotencyKey: job.idempotencyKey,
            createdAt: job.createdAt, meta: job.meta,
        };
        try
        {
            await this.dynamo.client.send( new UpdateCommand( {
                TableName: this.dynamo.table( WorkQueue.TABLE_JOBS ),
                Key: { queue: this.queue, jobId: job.jobId },
                UpdateExpression: "SET accountId = :accountId, #status = :status, statusAccountPk = :pk, priority = :priority, payloadRef = :payloadRef, idempotencyKey = :idempotencyKey, createdAt = :createdAt, meta = :meta",
                ConditionExpression: "attribute_not_exists( jobId )",
                ExpressionAttributeNames: { "#status": "status" },
                ExpressionAttributeValues: {
                    ":accountId": row.accountId, ":status": row.status, ":pk": row.statusAccountPk,
                    ":priority": row.priority, ":payloadRef": row.payloadRef, ":idempotencyKey": row.idempotencyKey,
                    ":createdAt": row.createdAt, ":meta": row.meta ?? null,
                },
            } ) );
        }
        catch( error : unknown )
        {
            // a duplicate enqueue of the same jobId is expected on a crash-and-retry — swallow it (no-op);
            // anything else is a real failure and should surface to the caller.
            if( ( error as { name? : string } )?.name !== "ConditionalCheckFailedException" ) throw error;
            return;
        }
        // NX: only seed a fresh account into the fairness order — an account already mid-round keeps its score.
        await this.cache.client.zadd( this.fairKey(), "NX", 0, job.accountId );
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////////////////
    // THE DISPATCH DECISION — called by the coordinator `Consumer`. Fairly select the next batch
    // (WFQ / DRR by account weight, smallest virtual-finish-time first) that is within rate limits and
    // below the SQS low-water-mark, LEASE them, and push job-id pointers to SQS (FIFO MessageGroupId =
    // accountId for interleave). Returns the leased jobs dispatched this round.
    public async dispatch( opts ? : { max ? : number } ) : Promise<Array<WorkQueue.Lease>>
    {
        // resolve queue-level batch/low-water/lease defaults, then work out how much ROOM this round has.
        const queueConfig : WorkQueue.QueueConfig | undefined = await this.readQueueConfig();
        const batchSize    : number = opts?.max ?? queueConfig?.batchSize ?? this.rules.batchSize ?? WorkQueue.DEFAULT_BATCH_SIZE;
        const lowWaterMark : number = queueConfig?.lowWaterMark ?? this.rules.lowWaterMark ?? WorkQueue.DEFAULT_LOW_WATER;
        const leaseSeconds : number = queueConfig?.leaseSeconds ?? this.rules.leaseSeconds ?? WorkQueue.DEFAULT_LEASE_SECONDS;

        const depthRaw : string | null = await this.cache.client.get( this.depthKey() );
        const depth    : number = depthRaw ? parseInt( depthRaw, 10 ) : 0;
        const room     : number = Math.max( 0, lowWaterMark - depth );
        const take     : number = Math.min( batchSize, room );
        if( take <= 0 ) return [];

        // pull MORE candidates than we need — the DRR walk skips throttled/empty accounts in one pass
        // rather than re-polling the ZSET, so a wider slice avoids under-filling the batch needlessly.
        const candidates : Array<string> = await this.cache.client.zrange( this.fairKey(), 0, ( take * 4 ) - 1 );

        const leases : Array<WorkQueue.Lease> = [];
        for( const accountId of candidates )
        {
            if( leases.length >= take ) break;

            // find the oldest PENDING job for this account via the fairness-purpose GSI (gap #8's prototype).
            const pending : Type.Result<Array<JobRow>> = await this.dynamo.query<JobRow>( WorkQueue.TABLE_JOBS, {
                IndexName: "gsi_status_account",
                KeyConditionExpression: "statusAccountPk = :pk",
                ExpressionAttributeValues: { ":pk": this.statusAccountPk( WorkQueue.Status.PENDING, accountId ) },
                Limit: 1, ScanIndexForward: true,
            } );
            if( !pending.ok || pending.data.length === 0 )
            {
                // nothing left for this account on this queue — it no longer belongs in the fairness order.
                await this.cache.client.zrem( this.fairKey(), accountId );
                continue;
            }

            const admission : WorkQueue.Admission = await this.admit( accountId, 1 );
            if( !admission.allowed ) continue;   // leave it in the ZSET; try the next candidate this round

            const job     : JobRow = pending.data[ 0 ];
            const leaseId : string = randomUUID();
            const expiresAt : Type.ISODateTime = new Date( Date.now() + ( leaseSeconds * 1000 ) ).toISOString();

            // atomically claim it (PENDING → PROCESSING); a concurrent dispatcher losing the race is a no-op skip.
            try
            {
                await this.dynamo.client.send( new UpdateCommand( {
                    TableName: this.dynamo.table( WorkQueue.TABLE_JOBS ),
                    Key: { queue: this.queue, jobId: job.jobId },
                    UpdateExpression: "SET #status = :processing, statusAccountPk = :pk, leaseId = :leaseId, leaseExpiresAt = :expiresAt",
                    ConditionExpression: "#status = :pending",
                    ExpressionAttributeNames: { "#status": "status" },
                    ExpressionAttributeValues: {
                        ":processing": WorkQueue.Status.PROCESSING, ":pending": WorkQueue.Status.PENDING,
                        ":pk": this.statusAccountPk( WorkQueue.Status.PROCESSING, accountId ),
                        ":leaseId": leaseId, ":expiresAt": expiresAt,
                    },
                } ) );
            }
            catch( error : unknown )
            {
                if( ( error as { name? : string } )?.name === "ConditionalCheckFailedException" ) continue;
                throw error;
            }

            // advance this account's virtual finish time by 1/weight (DRR deficit) and bump in-flight depth.
            const resolved : WorkQueue.ResolvedConfig = await this.resolveConfig( accountId );
            await this.cache.client.zincrby( this.fairKey(), 1 / Math.max( resolved.weight, 0.01 ), accountId );
            await this.cache.client.incr( this.inflightKey( accountId ) );
            await this.cache.client.incr( this.depthKey() );

            leases.push( { job: this.toJob( job ), leaseId, expiresAt } );
        }
        return leases;
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////////////////
    // RATE GATE — oversend protection to a downstream / provider. Token bucket (lazily refilled):
    // "may I send `want` to this account/queue right now?" → how many are allowed + when to retry.
    public async admit( accountId : Type.ID, want : number = 1 ) : Promise<WorkQueue.Admission>
    {
        const resolved : WorkQueue.ResolvedConfig = await this.resolveConfig( accountId );
        if( resolved.suspended ) return { allowed: false, count: 0 };

        const capPerMinute : number | undefined = resolved.limits.perMinute;
        if( capPerMinute === undefined ) return { allowed: true, count: want };   // no configured cap — unmetered

        const ratePerMs : number = capPerMinute / 60000;
        const now       : number = Date.now();
        const raw       : Record<string, string> = await this.cache.client.hgetall( this.bucketKey( accountId ) );
        const priorTokens  : number = raw.tokens       !== undefined ? parseFloat( raw.tokens )       : capPerMinute;
        const refilledAtMs : number = raw.refilledAtMs !== undefined ? parseInt( raw.refilledAtMs, 10 ) : now;
        const tokens : number = Math.min( capPerMinute, priorTokens + ( ( now - refilledAtMs ) * ratePerMs ) );

        if( tokens >= want )
        {
            await this.cache.client.hset( this.bucketKey( accountId ), { tokens: String( tokens - want ), refilledAtMs: String( now ) } );
            await this.cache.client.expire( this.bucketKey( accountId ), 3600 );
            return { allowed: true, count: want };
        }
        await this.cache.client.hset( this.bucketKey( accountId ), { tokens: String( tokens ), refilledAtMs: String( now ) } );
        await this.cache.client.expire( this.bucketKey( accountId ), 3600 );
        const retryAfterMs : number = Math.ceil( ( want - tokens ) / ratePerMs );
        return { allowed: false, count: Math.floor( tokens ), retryAfterMs };
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////////////////
    // METRICS — INCR the current per-minute bin (TTL'd). Windows are summed on read (no rolling totals).
    public async record( accountId : Type.ID, count : number = 1 ) : Promise<void>
    {
        const key : string = this.binKey( accountId, new Date() );
        await this.cache.client.incrby( key, count );
        await this.cache.client.expire( key, WorkQueue.BIN_TTL_SECONDS );
    }

    // Sum-on-read the 1m / 5m / 1h / 1d windows from the per-minute bins (pipelined).
    public async windows( accountId : Type.ID ) : Promise<WorkQueue.Windows>
    {
        const now : Date = new Date();
        const sumLastMinutes = async ( minutes : number ) : Promise<number> =>
        {
            const pipeline = this.cache.client.pipeline();
            for( let index : number = 0; index < minutes; index++ )
                pipeline.get( this.binKey( accountId, new Date( now.getTime() - ( index * 60000 ) ) ) );
            const results : Array<[ Error | null, unknown ]> = await pipeline.exec() ?? [];
            return results.reduce( ( sum : number, [ , value ] : [ Error | null, unknown ] ) : number => sum + ( value ? parseInt( String( value ), 10 ) : 0 ), 0 );
        };
        return {
            m1: await sumLastMinutes( 1 ), m5: await sumLastMinutes( 5 ),
            h1: await sumLastMinutes( 60 ), d1: await sumLastMinutes( 1440 ),
        };
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////////////////
    // CONFIG (DynamoDB) — resolve the EFFECTIVE governance for an account, 3-tier most-specific-first:
    // AccountQueueConfig → AccountConfig → QueueConfig → the constructor `Rules`.
    public async resolveConfig( accountId : Type.ID ) : Promise<WorkQueue.ResolvedConfig>
    {
        const accountQueueGot : Type.Result<WorkQueue.AccountQueueConfig | undefined> = await this.dynamo.get<WorkQueue.AccountQueueConfig>( WorkQueue.TABLE_ACCOUNT_QUEUE_CONFIG, { accountId, queue: this.queue } );
        const accountGot      : Type.Result<WorkQueue.AccountConfig | undefined>      = await this.dynamo.get<WorkQueue.AccountConfig>( WorkQueue.TABLE_ACCOUNT_CONFIG, { accountId } );
        const queueConfig     : WorkQueue.QueueConfig | undefined = await this.readQueueConfig();
        const accountQueue : WorkQueue.AccountQueueConfig | undefined = accountQueueGot.ok ? accountQueueGot.data : undefined;
        const account      : WorkQueue.AccountConfig | undefined      = accountGot.ok ? accountGot.data : undefined;

        return {
            accountId, queue: this.queue,
            limits: accountQueue?.limits ?? queueConfig?.defaultLimits ?? this.rules.limits ?? {},
            weight: accountQueue?.weight ?? account?.weight ?? this.rules.defaultWeight ?? WorkQueue.DEFAULT_WEIGHT,
            priority: accountQueue?.priority ?? account?.priority ?? WorkQueue.DEFAULT_PRIORITY,
            suspended: Boolean( accountQueue?.suspended ?? account?.suspended ?? false ),
            batchSize: queueConfig?.batchSize ?? this.rules.batchSize ?? WorkQueue.DEFAULT_BATCH_SIZE,
            lowWaterMark: queueConfig?.lowWaterMark ?? this.rules.lowWaterMark ?? WorkQueue.DEFAULT_LOW_WATER,
            leaseSeconds: queueConfig?.leaseSeconds ?? this.rules.leaseSeconds ?? WorkQueue.DEFAULT_LEASE_SECONDS,
        };
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////////////////
    // ACTIVITY (Redis) — the per-account snapshot the dispatch decision reads: resolved config ⊕ live
    // counters / token bucket / fairness score / in-flight / suspension.
    public async accountState( accountId : Type.ID ) : Promise<WorkQueue.AccountState>
    {
        const resolved : WorkQueue.ResolvedConfig = await this.resolveConfig( accountId );
        const windows  : WorkQueue.Windows = await this.windows( accountId );

        const bucketRaw : Record<string, string> = await this.cache.client.hgetall( this.bucketKey( accountId ) );
        const bucket : WorkQueue.TokenBucketState = {
            tokens: bucketRaw.tokens !== undefined ? parseFloat( bucketRaw.tokens ) : ( resolved.limits.perMinute ?? 0 ),
            refilledAtMs: bucketRaw.refilledAtMs !== undefined ? parseInt( bucketRaw.refilledAtMs, 10 ) : Date.now(),
        };
        const fairScoreRaw : string | null = await this.cache.client.zscore( this.fairKey(), accountId );
        const inflightRaw  : string | null = await this.cache.client.get( this.inflightKey( accountId ) );

        const pendingCount : QueryCommandOutput = await this.dynamo.client.send( new QueryCommand( {
            TableName: this.dynamo.table( WorkQueue.TABLE_JOBS ), IndexName: "gsi_status_account",
            KeyConditionExpression: "statusAccountPk = :pk",
            ExpressionAttributeValues: { ":pk": this.statusAccountPk( WorkQueue.Status.PENDING, accountId ) },
            Select: "COUNT",
        } ) );

        return {
            accountId, pending: pendingCount.Count ?? 0, inflight: inflightRaw ? parseInt( inflightRaw, 10 ) : 0,
            windows, bucket, fairScore: fairScoreRaw ? parseFloat( fairScoreRaw ) : 0, suspended: resolved.suspended,
        };
    }

    // Every account currently a member of the fairness ZSET — i.e. every account with at least one PENDING job
    // on this queue right now (an account with only PROCESSING/COMPLETE/FAILED jobs, or none at all, is absent —
    // see `enqueue`/`dispatch`'s ZADD/ZREM bookkeeping). The observability entry point for {@link snapshot}.
    public async listActiveAccounts() : Promise<Array<Type.ID>>
    {
        return this.cache.client.zrange( this.fairKey(), 0, -1 );
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////////////////
    // OBSERVABILITY — an operator-facing aggregate view (queue depth/defaults + a bounded set of active accounts'
    // `accountState`), for an adopting service's own admin endpoint to serialize as-is. NOT on any hot path.
    public async snapshot( opts : { maxAccounts ? : number } = {} ) : Promise<WorkQueue.QueueSnapshot>
    {
        const maxAccounts : number = opts.maxAccounts ?? 100;
        const queueConfig : WorkQueue.QueueConfig | undefined = await this.readQueueConfig();
        const depthRaw : string | null = await this.cache.client.get( this.depthKey() );

        const accountIds : Array<Type.ID> = await this.listActiveAccounts();
        const bounded     : Array<Type.ID> = accountIds.slice( 0, maxAccounts );
        const accounts    : Array<WorkQueue.AccountState> = [];
        for( const accountId of bounded ) accounts.push( await this.accountState( accountId ) );

        return {
            queue: this.queue, depth: depthRaw ? parseInt( depthRaw, 10 ) : 0,
            lowWaterMark: queueConfig?.lowWaterMark ?? this.rules.lowWaterMark ?? WorkQueue.DEFAULT_LOW_WATER,
            batchSize: queueConfig?.batchSize ?? this.rules.batchSize ?? WorkQueue.DEFAULT_BATCH_SIZE,
            leaseSeconds: queueConfig?.leaseSeconds ?? this.rules.leaseSeconds ?? WorkQueue.DEFAULT_LEASE_SECONDS,
            accounts, truncated: accountIds.length > bounded.length,
        };
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////////////////
    // JOB LIFECYCLE — lease (→ processing, idempotency key), complete (→ complete), fail (→ failed / DLQ).
    public async lease( jobId : Type.ID ) : Promise<WorkQueue.Lease | null>
    {
        const got : Type.Result<JobRow | undefined> = await this.dynamo.get<JobRow>( WorkQueue.TABLE_JOBS, { queue: this.queue, jobId } );
        if( !got.ok || !got.data || !got.data.leaseId || !got.data.leaseExpiresAt ) return null;
        return { job: this.toJob( got.data ), leaseId: got.data.leaseId, expiresAt: got.data.leaseExpiresAt };
    }

    public async complete( jobId : Type.ID ) : Promise<void>
    {
        const got : Type.Result<JobRow | undefined> = await this.dynamo.get<JobRow>( WorkQueue.TABLE_JOBS, { queue: this.queue, jobId } );
        if( !got.ok || !got.data ) return;
        await this.dynamo.client.send( new UpdateCommand( {
            TableName: this.dynamo.table( WorkQueue.TABLE_JOBS ), Key: { queue: this.queue, jobId },
            UpdateExpression: "SET #status = :status, statusAccountPk = :pk REMOVE leaseId, leaseExpiresAt",
            ExpressionAttributeNames: { "#status": "status" },
            ExpressionAttributeValues: { ":status": WorkQueue.Status.COMPLETE, ":pk": this.statusAccountPk( WorkQueue.Status.COMPLETE, got.data.accountId ) },
        } ) );
        await this.releaseInflight( got.data.accountId );
    }

    public async fail( jobId : Type.ID, reason : string ) : Promise<void>
    {
        const got : Type.Result<JobRow | undefined> = await this.dynamo.get<JobRow>( WorkQueue.TABLE_JOBS, { queue: this.queue, jobId } );
        if( !got.ok || !got.data ) return;
        await this.dynamo.client.send( new UpdateCommand( {
            TableName: this.dynamo.table( WorkQueue.TABLE_JOBS ), Key: { queue: this.queue, jobId },
            UpdateExpression: "SET #status = :status, statusAccountPk = :pk, failReason = :reason REMOVE leaseId, leaseExpiresAt",
            ExpressionAttributeNames: { "#status": "status" },
            ExpressionAttributeValues: { ":status": WorkQueue.Status.FAILED, ":pk": this.statusAccountPk( WorkQueue.Status.FAILED, got.data.accountId ), ":reason": reason },
        } ) );
        await this.releaseInflight( got.data.accountId );
    }

    // shared lease-release bookkeeping for complete()/fail() — decrement in-flight + queue depth (floor at 0).
    private async releaseInflight( accountId : Type.ID ) : Promise<void>
    {
        const inflight : number = await this.cache.client.decr( this.inflightKey( accountId ) );
        if( inflight < 0 ) await this.cache.client.set( this.inflightKey( accountId ), "0" );
        const depth : number = await this.cache.client.decr( this.depthKey() );
        if( depth < 0 ) await this.cache.client.set( this.depthKey(), "0" );
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////////////////
    // PACING — the earliest instant anything could change (next token refill / window rollover / lease
    // expiry). The coordinator `Consumer` self-schedules exactly one wake-up at this time instead of polling.
    public async nextWakeAt() : Promise<Type.ISODateTime>
    {
        const now : number = Date.now();
        // next minute-bin rollover — windows() depends on the current bin, so a rollover is always "interesting".
        const msToNextMinute : number = 60000 - ( now % 60000 );
        let earliest : number = now + msToNextMinute;

        // earliest token-bucket refill across every account currently holding pending work.
        const members : Array<string> = await this.cache.client.zrange( this.fairKey(), 0, -1 );
        for( const accountId of members )
        {
            const resolved : WorkQueue.ResolvedConfig = await this.resolveConfig( accountId );
            const capPerMinute : number | undefined = resolved.limits.perMinute;
            if( capPerMinute === undefined ) { earliest = now; continue; }   // unmetered — nothing to wait on

            const raw : Record<string, string> = await this.cache.client.hgetall( this.bucketKey( accountId ) );
            const ratePerMs : number = capPerMinute / 60000;
            const tokens : number = raw.tokens !== undefined ? parseFloat( raw.tokens ) : capPerMinute;
            if( tokens >= 1 ) { earliest = now; continue; }
            const refilledAtMs : number = raw.refilledAtMs !== undefined ? parseInt( raw.refilledAtMs, 10 ) : now;
            const msUntilOneToken : number = Math.ceil( ( 1 - tokens ) / ratePerMs ) - ( now - refilledAtMs );
            earliest = Math.min( earliest, now + Math.max( 0, msUntilOneToken ) );
        }
        return new Date( Math.max( now, earliest ) ).toISOString();
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////////////////
    // SUSPENSION — priority 0 holds an account's work for THIS queue/channel (e.g. suspend email, leave SMS
    // flowing); resume re-admits. Compliance hold / abuse lever; audited by the caller.
    public async suspend( accountId : Type.ID ) : Promise<void> { await this.setSuspended( accountId, true ); }
    public async resume( accountId : Type.ID )  : Promise<void> { await this.setSuspended( accountId, false ); }

    // shared read-merge-write for the per-account-per-queue override row (suspend()/resume() differ only in the flag).
    private async setSuspended( accountId : Type.ID, suspended : boolean ) : Promise<void>
    {
        const got : Type.Result<WorkQueue.AccountQueueConfig | undefined> = await this.dynamo.get<WorkQueue.AccountQueueConfig>( WorkQueue.TABLE_ACCOUNT_QUEUE_CONFIG, { accountId, queue: this.queue } );
        const existing : WorkQueue.AccountQueueConfig | undefined = got.ok ? got.data : undefined;
        const wrote : Type.Result<void> = await this.dynamo.put( WorkQueue.TABLE_ACCOUNT_QUEUE_CONFIG, {
            ...existing, accountId, queue: this.queue, suspended,
            updated: { at: new Date().toISOString(), by: accountId },
        } );
        if( !wrote.ok ) throw new Error( `WorkQueue.setSuspended: ${ wrote.error }` );
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////////////////
    // internal helpers — key builders (Redis) + row/config readers (DynamoDB).

    private fairKey()                                : string { return `wq:${ this.queue }:fair`; }
    private depthKey()                               : string { return `wq:${ this.queue }:depth`; }
    private inflightKey( accountId : Type.ID )        : string { return `wq:${ this.queue }:acct:${ accountId }:inflight`; }
    private bucketKey( accountId : Type.ID )          : string { return `wq:${ this.queue }:acct:${ accountId }:bucket`; }
    private binKey( accountId : Type.ID, at : Date )  : string { return `wq:${ this.queue }:acct:${ accountId }:bin:${ WorkQueue.minuteStamp( at ) }`; }
    private statusAccountPk( status : WorkQueue.Status, accountId : Type.ID ) : string { return `${ this.queue }#${ status }#${ accountId }`; }

    // `yyyymmddHHmm` in UTC — the per-minute bin stamp.
    private static minuteStamp( at : Date ) : string
    {
        const pad = ( value : number ) : string => String( value ).padStart( 2, "0" );
        return `${ at.getUTCFullYear() }${ pad( at.getUTCMonth() + 1 ) }${ pad( at.getUTCDate() ) }${ pad( at.getUTCHours() ) }${ pad( at.getUTCMinutes() ) }`;
    }

    private async readQueueConfig() : Promise<WorkQueue.QueueConfig | undefined>
    {
        const got : Type.Result<WorkQueue.QueueConfig | undefined> = await this.dynamo.get<WorkQueue.QueueConfig>( WorkQueue.TABLE_QUEUE_CONFIG, { queue: this.queue } );
        return got.ok ? got.data : undefined;
    }

    private toJob( row : JobRow ) : WorkQueue.Job
    {
        return {
            jobId: row.jobId, accountId: row.accountId, queue: row.queue, priority: row.priority,
            payloadRef: row.payloadRef, idempotencyKey: row.idempotencyKey, createdAt: row.createdAt, meta: row.meta,
        };
    }
}

export namespace WorkQueue
{
    /** Governed-store lifecycle; `0` priority = suspended. */
    export enum Status { PENDING = "pending", PROCESSING = "processing", COMPLETE = "complete", FAILED = "failed", SUSPENDED = "suspended" }

    /** One governed unit of work. The QUEUE carries the pointer, never the payload (no PII in SQS). */
    export interface Job
    {
        jobId:          Type.ID;
        accountId:      Type.ID;
        queue:          string;            // channel-type: email / sms / webhook / report / …
        priority:       number;            // 0–10 (0 = suspended)
        payloadRef:     Type.ID;           // pointer to the real record (DB id / S3 key) — NOT the payload
        idempotencyKey: string;            // no double-send on crash-after-push
        createdAt:      Type.ISODateTime;
        meta?:          Type.JsonObject;   // channel-specific metadata for the fairness/rate decision
    }

    /** A leased job + its lease (visibility lease for crash-safe, idempotent processing). */
    export interface Lease { job : Job; leaseId : string; expiresAt : Type.ISODateTime; }

    /** Hard rate caps per account/queue, enforced by the token bucket. */
    export interface RateLimits { perMinute?: number; per5Minutes?: number; perHour?: number; perDay?: number; }

    /** Token-bucket verdict — how many may go now, and when to retry if throttled. */
    export interface Admission { allowed : boolean; count : number; retryAfterMs? : number; }

    /** Sum-on-read counters across the standard windows. */
    export interface Windows { m1 : number; m5 : number; h1 : number; d1 : number; }

    /** Channel-level static defaults passed at construction (rarely change). PER-ACCOUNT config is
     *  durable in DynamoDB (below), not here — this is just the queue's shape / fallback. */
    export interface Rules
    {
        limits?:             RateLimits;   // default per-account caps when there's no Dynamo override
        defaultWeight?:      number;       // default WFQ/DRR weight (default 1)
        batchSize?:          number;       // max jobs dispatched per round
        lowWaterMark?:       number;       // keep SQS shallow — refill only below this in-flight depth
        leaseSeconds?:       number;       // visibility lease for crash-safe processing
        fifoGroupByAccount?: boolean;      // SQS FIFO MessageGroupId = accountId (interleave)
    }

    // ──────────────────────────────────────────────────────────────────────────
    // CONFIGURATION — DynamoDB (durable, operator-tuned, read-mostly).
    // Resolved most-specific-first: AccountQueueConfig → AccountConfig → QueueConfig → Rules.
    // ──────────────────────────────────────────────────────────────────────────

    export interface Stamp { at : Type.ISODateTime; by : Type.ID; }

    /** Per-channel/queue defaults + topology.   table `wq_queue_config`   PK: queue */
    export interface QueueConfig
    {
        queue:               string;       // "email" | "sms" | "webhook" | "report" | …
        defaultLimits:       RateLimits;   // per-account caps when there's no account override
        defaultWeight:       number;       // WFQ/DRR weight when there's no override (default 1)
        batchSize:           number;       // max jobs per dispatch round
        lowWaterMark:        number;       // keep SQS shallow — refill only below this in-flight depth
        leaseSeconds:        number;       // visibility-lease duration
        fifoGroupByAccount?: boolean;      // SQS FIFO MessageGroupId = accountId
        priorityRatio?:      { [tier : string] : number };  // weighted poll ratio, e.g. { gold:5, silver:2, bronze:1 }
        updated:             Stamp;
    }

    /** Account-wide governance (spans channels).   table `wq_account_config`   PK: accountId */
    export interface AccountConfig
    {
        accountId:  Type.ID;
        priority:   number;                // 0–10 (0 = suspended); the platform account priority (1–5) maps here
        weight:     number;                // WFQ/DRR weight — higher = larger fair share
        suspended?: boolean;               // global hold across ALL channels
        updated:    Stamp;
    }

    /** Per-account, per-channel OVERRIDE (most specific).   table `wq_account_queue_config`   PK: accountId  SK: queue */
    export interface AccountQueueConfig
    {
        accountId:  Type.ID;
        queue:      string;
        limits?:    RateLimits;            // override the channel default caps for this account+channel
        weight?:    number;                // override the account weight for this channel
        priority?:  number;                // 0–10; 0 = suspend THIS channel only (hold email, keep sms flowing)
        suspended?: boolean;
        updated:    Stamp;
    }

    /** The merged, EFFECTIVE config the governor decides with (the 3-tier resolution applied). */
    export interface ResolvedConfig
    {
        accountId:    Type.ID;
        queue:        string;
        limits:       RateLimits;          // effective caps
        weight:       number;              // effective WFQ/DRR weight
        priority:     number;              // effective 0–10
        suspended:    boolean;             // account-global OR per-channel
        batchSize:    number;
        lowWaterMark: number;
        leaseSeconds: number;
    }

    // ──────────────────────────────────────────────────────────────────────────
    // ACTIVITY — Redis (ephemeral, atomic, TTL'd). What the governor READS to decide "who's next +
    // how many now". Never the SoT; fully rebuildable. Key prefix `wq:{queue}:…`.
    // ──────────────────────────────────────────────────────────────────────────

    /** Per-minute send-count bin (the rate metric).
     *  KEY  `wq:{queue}:acct:{accountId}:bin:{yyyymmddHHmm}`  → INT   (INCR on send; TTL ~2 days).
     *  Windows are SUMMED ON READ over the bins (no rolling totals → no expiry-decrement bug). */
    export interface ActivityBin { queue : string; accountId : Type.ID; minute : string; count : number; }

    /** Token-bucket state (the rate gate).
     *  KEY  `wq:{queue}:acct:{accountId}:bucket`  → HASH { tokens, refilledAtMs }.
     *  Lazily refilled on read: tokens = min(cap, tokens + (now − refilledAtMs)·rate); cap + rate from CONFIG. */
    export interface TokenBucketState { tokens : number; refilledAtMs : number; }

    /** Fairness ordering — one sorted set per queue; score = virtual finish time (DRR).
     *  KEY  `wq:{queue}:fair`  → ZSET (member = accountId, score = virtualFinish).
     *  Pick next via ZPOPMIN / ZRANGEBYSCORE; on dispatch advance the score by cost / weight. Only
     *  accounts WITH pending work are members. */
    export interface FairnessEntry { accountId : Type.ID; score : number; }

    /** Self-tracked in-flight (don't trust SQS Approximate* — we're the dispatcher).
     *  KEYS  `wq:{queue}:acct:{accountId}:inflight` → INT   ·   `wq:{queue}:depth` → INT (vs lowWaterMark). */
    export interface InFlight { queue : string; accountId? : Type.ID; count : number; }

    /** Active lease (crash-safe + idempotent).
     *  KEY  `wq:{queue}:lease:{jobId}`  → HASH { leaseId, accountId, expiresAtMs }   (TTL = leaseSeconds). */
    export interface LeaseState { jobId : Type.ID; accountId : Type.ID; leaseId : string; expiresAtMs : number; }

    /** The per-account snapshot the dispatch decision reads — resolved CONFIG ⊕ live ACTIVITY merged. */
    export interface AccountState
    {
        accountId: Type.ID;
        pending:   number;                 // jobs waiting (governed store / pending counter)
        inflight:  number;                 // currently on SQS / processing (self-tracked)
        windows:   Windows;                // recent send rate (summed bins)
        bucket:    TokenBucketState;       // current tokens
        fairScore: number;                 // current virtual finish time (fairness order)
        suspended: boolean;
    }

    /** {@link WorkQueue.snapshot}'s result — an operator-facing aggregate, safe to serialize as-is over an
     *  adopting service's own admin endpoint (see `@repo/api`'s `Dispatch.QueueSnapshot`, the shared wire
     *  shape this mirrors so Console can render one generic panel across every `WorkQueue` adopter). */
    export interface QueueSnapshot
    {
        queue:        string;
        depth:        number;
        lowWaterMark: number;
        batchSize:    number;
        leaseSeconds: number;
        accounts:     Array<AccountState>;
        truncated:    boolean;             // true if more active accounts exist than `accounts` lists
    }
}

export default WorkQueue;
