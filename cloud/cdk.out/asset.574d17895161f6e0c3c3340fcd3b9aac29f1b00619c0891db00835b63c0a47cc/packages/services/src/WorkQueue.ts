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
// STORAGE split:
//   • CONFIGURATION — DynamoDB (durable, operator-tuned, read-mostly): account limits / weights /
//     priority / suspension. See WorkQueue.QueueConfig · AccountConfig · AccountQueueConfig.
//   • ACTIVITY — Redis (ephemeral, atomic, TTL'd, rebuildable): the per-minute bins, token buckets,
//     the fairness ZSET, in-flight counts, leases — what the governor READS to decide "who's next +
//     how many now". See WorkQueue.ActivityBin · TokenBucketState · FairnessEntry · InFlight · LeaseState.
// The durable JOB store + lifecycle is DynamoDB; SQS carries a job-id POINTER, never the payload (no
// PII in the queue). Method bodies are the contract; impl lands once the queue-topology decision
// settles (dispatch gap #9).
//

import type { CloudResolver } from "@repo/cloud-manifest";
import type { Type } from "@repo/common";

import { Cache } from "./aws/Cache";
import { Dynamo } from "./aws/Dynamo";
import { Sqs } from "./aws/Sqs";

export class WorkQueue
{
    private _cache?  : Cache;
    private _dynamo? : Dynamo;
    private _sqs?    : Sqs;

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
    // Enqueue a job into the GOVERNED store (DynamoDB, status=pending) + record the per-minute metric bin.
    // The payload is NOT stored here — `job.payloadRef` points at the real record (DB id / S3 key).
    public async enqueue( job : WorkQueue.Job ) : Promise<void>
    {
        throw new Error("WorkQueue.enqueue: not implemented (contract — pending datastore decision)");
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////////////////
    // THE DISPATCH DECISION — called by the coordinator `Consumer`. Fairly select the next batch
    // (WFQ / DRR by account weight, smallest virtual-finish-time first) that is within rate limits and
    // below the SQS low-water-mark, LEASE them, and push job-id pointers to SQS (FIFO MessageGroupId =
    // accountId for interleave). Returns the leased jobs dispatched this round.
    public async dispatch( opts ? : { max ? : number } ) : Promise<Array<WorkQueue.Lease>>
    {
        throw new Error("WorkQueue.dispatch: not implemented (contract)");
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////////////////
    // RATE GATE — oversend protection to a downstream / provider. Token bucket (lazily refilled):
    // "may I send `want` to this account/queue right now?" → how many are allowed + when to retry.
    public async admit( accountId : Type.ID, want : number = 1 ) : Promise<WorkQueue.Admission>
    {
        throw new Error("WorkQueue.admit: not implemented (contract)");
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////////////////
    // METRICS — INCR the current per-minute bin (TTL'd). Windows are summed on read (no rolling totals).
    public async record( accountId : Type.ID, count : number = 1 ) : Promise<void>
    {
        throw new Error("WorkQueue.record: not implemented (contract)");
    }

    // Sum-on-read the 1m / 5m / 1h / 1d windows from the per-minute bins (pipelined).
    public async windows( accountId : Type.ID ) : Promise<WorkQueue.Windows>
    {
        throw new Error("WorkQueue.windows: not implemented (contract)");
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////////////////
    // CONFIG (DynamoDB) — resolve the EFFECTIVE governance for an account, 3-tier most-specific-first:
    // AccountQueueConfig → AccountConfig → QueueConfig → the constructor `Rules`.
    public async resolveConfig( accountId : Type.ID ) : Promise<WorkQueue.ResolvedConfig>
    {
        throw new Error("WorkQueue.resolveConfig: not implemented (contract)");
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////////////////
    // ACTIVITY (Redis) — the per-account snapshot the dispatch decision reads: resolved config ⊕ live
    // counters / token bucket / fairness score / in-flight / suspension.
    public async accountState( accountId : Type.ID ) : Promise<WorkQueue.AccountState>
    {
        throw new Error("WorkQueue.accountState: not implemented (contract)");
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////////////////
    // JOB LIFECYCLE — lease (→ processing, idempotency key), complete (→ complete), fail (→ failed / DLQ).
    public async lease( jobId : Type.ID ) : Promise<WorkQueue.Lease | null>
    {
        throw new Error("WorkQueue.lease: not implemented (contract)");
    }
    public async complete( jobId : Type.ID ) : Promise<void>
    {
        throw new Error("WorkQueue.complete: not implemented (contract)");
    }
    public async fail( jobId : Type.ID, reason : string ) : Promise<void>
    {
        throw new Error("WorkQueue.fail: not implemented (contract)");
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////////////////
    // PACING — the earliest instant anything could change (next token refill / window rollover / lease
    // expiry). The coordinator `Consumer` self-schedules exactly one wake-up at this time instead of polling.
    public async nextWakeAt() : Promise<Type.ISODateTime>
    {
        throw new Error("WorkQueue.nextWakeAt: not implemented (contract)");
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////////////////
    // SUSPENSION — priority 0 holds an account's work for THIS queue/channel (e.g. suspend email, leave SMS
    // flowing); resume re-admits. Compliance hold / abuse lever; audited by the caller.
    public async suspend( accountId : Type.ID ) : Promise<void>
    {
        throw new Error("WorkQueue.suspend: not implemented (contract)");
    }
    public async resume( accountId : Type.ID ) : Promise<void>
    {
        throw new Error("WorkQueue.resume: not implemented (contract)");
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
}

export default WorkQueue;
