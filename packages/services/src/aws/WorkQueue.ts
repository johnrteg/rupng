//
// WorkQueue — a reusable multi-tenant **fair-share** work queue, so one account's burst can't
// starve everyone else's. A drop-in pattern for any service that digests per-account work
// (webhook ingestion, workflow steps, dispatch jobs, …).
//
// Two queues, one abstraction:
//   * PRIORITY (standard SQS) — system / time-sensitive work, drained FIRST.
//   * FAIR (SQS **FIFO**, MessageGroupId = the tenant key) — per-account work.
//
// Why FIFO for the fair queue: SQS FIFO delivers across message groups but holds **one in-flight
// message per group** until it's deleted. With MessageGroupId = accountId, a single flooding account
// occupies only its own group's slot, while consumers keep receiving from *other* groups — natural,
// near-zero-code fairness (plus per-account ordering). One account can't monopolize the workers.
//
// Trade-off: per-account throughput is one-message-at-a-time (ordered). For higher per-account
// parallelism, shard the group key (`accountId#0..k`); for very high aggregate volume, enable SQS
// high-throughput FIFO. For pure rate-fairness instead of ordering, a Redis token-bucket gate on a
// standard queue is the alternative (not implemented here — FIFO grouping covers the common case).
//
import type { Message } from "@aws-sdk/client-sqs";
import type { CloudResolver, ResourceKey } from "@repo/cloud-spec";
import { ResultUtils } from "@repo/common";
import type { Type } from "@repo/common";

import { Sqs } from "./Sqs";

/**
 * A fair-share work queue over the {@link Sqs} facade. Producers {@link submit} work tagged with a
 * **fairness key** (usually `accountId`); consumers {@link receive} it priority-first, then fairly
 * round-robined across tenants. Resolve queues by their cloud-spec logical keys.
 *
 * A service typically owns two queues in its manifest: a standard `…-priority` queue and a **FIFO**
 * `…-fair` queue (`fifo: true`).
 */
export class WorkQueue
{
    private readonly sqs  : Sqs;
    private readonly opts : WorkQueue.Options;
    private fairAccumulator : number = 0;       // weighted-token state for fair-queue turns

    ///////////////////////////////////////////////////////////////////////////////////////////
    /**
     * @param cloud the owning service's resolver — maps logical queue keys to physical urls.
     * @param opts  the fair queue key (required) + optional system-priority queue key.
     */
    constructor( cloud : CloudResolver, opts : WorkQueue.Options )
    {
        this.sqs  = new Sqs( cloud );
        this.opts = opts;
    }

    ///////////////////////////////////////////////////////////////////////////////////////////
    /**
     * Enqueue work. By default it goes to the **fair** (per-tenant) queue under `fairnessKey`; set
     * `priority: true` to route it to the **system priority** queue instead (drained first).
     *
     * @param body    the message payload (object → JSON).
     * @param submit  routing — `fairnessKey` (required unless `priority`), `priority`, `dedupeId`.
     */
    submit( body : string | object, submit : WorkQueue.SubmitOptions ) : Promise<Type.Result<void>>
    {
        if( submit.priority )
        {
            if( this.opts.priorityKey === undefined )
                return Promise.resolve( ResultUtils.err<void>( "WorkQueue.submit: priority requested but no priorityKey configured" ) );
            return this.sqs.send( this.opts.priorityKey, body );
        }

        if( submit.fairnessKey === undefined )
            return Promise.resolve( ResultUtils.err<void>( "WorkQueue.submit: fairnessKey is required for fair-share work" ) );
        // FIFO requires a group id (the tenant) and a dedup id (or content-based dedup on the queue).
        return this.sqs.send( this.opts.fairKey, body, { groupId: submit.fairnessKey, dedupeId: submit.dedupeId } );
    }

    ///////////////////////////////////////////////////////////////////////////////////////////
    /**
     * Receive a batch to process. Which queue gets first dibs this cycle is governed by
     * {@link WorkQueue.Options.fairWeight}: by default (`0`) the **priority** queue is checked first
     * and the **fair** queue only when priority is empty (system work pre-empts); a higher weight
     * periodically gives the fair queue first dibs so a saturated priority queue can't starve tenants.
     * The chosen-first queue is short-polled; the fallback is long-polled (no busy-wait). Tenant work
     * is delivered fairly across accounts by FIFO group distribution. Each returned
     * {@link WorkQueue.Item} MUST be {@link ack}'d after successful processing.
     *
     * @param max         max messages (1–10, default 10).
     * @param waitSeconds long-poll wait on the fallback queue (0–20, default 20).
     */
    async receive( max : number = 10, waitSeconds : number = 20 ) : Promise<Type.Result<Array<WorkQueue.Item>>>
    {
        const tag = ( messages : Array<Message>, source : WorkQueue.Item[ "source" ], queueKey : ResourceKey ) : Array<WorkQueue.Item> =>
            messages.map( ( message ) => ( { source, queueKey, message } ) );

        // No priority queue → always the fair queue.
        if( this.opts.priorityKey === undefined )
        {
            const fair : Type.Result<Array<Message>> = await this.sqs.receive( this.opts.fairKey, max, waitSeconds );
            return fair.ok ? ResultUtils.ok( tag( fair.data, "fair", this.opts.fairKey ) ) : fair;
        }

        // Pick this cycle's order by weight (anti-starvation), then short-poll first / long-poll fallback.
        const fairFirst  : boolean = this.takeFairTurn();
        const firstKey   : ResourceKey                  = fairFirst ? this.opts.fairKey : this.opts.priorityKey;
        const firstSrc   : WorkQueue.Item[ "source" ]   = fairFirst ? "fair" : "priority";
        const secondKey  : ResourceKey                  = fairFirst ? this.opts.priorityKey : this.opts.fairKey;
        const secondSrc  : WorkQueue.Item[ "source" ]   = fairFirst ? "priority" : "fair";

        const first : Type.Result<Array<Message>> = await this.sqs.receive( firstKey, max, 0 );
        if( !first.ok ) return first;
        if( first.data.length > 0 ) return ResultUtils.ok( tag( first.data, firstSrc, firstKey ) );

        const second : Type.Result<Array<Message>> = await this.sqs.receive( secondKey, max, waitSeconds );
        return second.ok ? ResultUtils.ok( tag( second.data, secondSrc, secondKey ) ) : second;
    }

    ///////////////////////////////////////////////////////////////////////////////////////////
    /**
     * Deterministic weighted token: returns true on a `fairWeight` fraction of cycles (so the fair
     * queue gets first dibs that often). `0` → never (priority rules); `1` → always (fair rules).
     */
    private takeFairTurn() : boolean
    {
        const weight : number = this.opts.fairWeight ?? 0;
        if( weight <= 0 ) return false;
        if( weight >= 1 ) return true;

        this.fairAccumulator += weight;
        if( this.fairAccumulator >= 1 ) { this.fairAccumulator -= 1; return true; }
        return false;
    }

    ///////////////////////////////////////////////////////////////////////////////////////////
    /** Acknowledge (delete) a processed item so it isn't redelivered. */
    ack( item : WorkQueue.Item ) : Promise<Type.Result<void>>
    {
        if( item.message.ReceiptHandle === undefined )
            return Promise.resolve( ResultUtils.err<void>( "WorkQueue.ack: message has no ReceiptHandle" ) );
        return this.sqs.delete( item.queueKey, item.message.ReceiptHandle );
    }

    ///////////////////////////////////////////////////////////////////////////////////////////
    /** Escape hatch — the underlying {@link Sqs} facade for batch/attribute operations. */
    get queue() : Sqs { return this.sqs; }
}

export namespace WorkQueue
{
    /** Which queues back this WorkQueue (cloud-spec logical keys) + the priority/fair policy. */
    export interface Options
    {
        /** The FIFO per-tenant fair queue (`fifo: true` in the manifest). */
        fairKey      : ResourceKey;
        /** Optional standard queue for system / time-sensitive work, drained before fair work. */
        priorityKey? : ResourceKey;
        /**
         * How often a `receive()` cycle gives the **fair** queue first dibs, in `[0, 1]` — the
         * anti-starvation knob (a saturated priority queue otherwise blocks all tenant work forever):
         *   * **`0`** (default) — **priority strictly rules**: always priority-first (use when
         *     system events truly must pre-empt and their volume is low).
         *   * **`1`** — **fair strictly rules**: always fair-first; priority served only when fair is empty.
         *   * **`0 < w < 1`** — fair gets first dibs on a `w` fraction of cycles (e.g. `0.2` ≈ every 5th),
         *     guaranteeing tenant work progresses even while priority is backed up.
         * Deterministic (weighted token), not random.
         */
        fairWeight?  : number;
    }

    /** Routing for a single {@link WorkQueue.submit}. */
    export interface SubmitOptions
    {
        /** Tenant fairness key (usually `accountId`) — required for fair work (the FIFO group). */
        fairnessKey? : string;
        /** Route to the system priority queue instead of the fair queue. */
        priority?    : boolean;
        /** FIFO dedup id (omit if the fair queue uses content-based dedup). */
        dedupeId?    : string;
    }

    /** A received unit of work, tagged with which queue it came from (for {@link WorkQueue.ack}). */
    export interface Item
    {
        /** Which queue delivered it. */
        source   : "priority" | "fair";
        /** The logical queue key (for ack/delete). */
        queueKey : ResourceKey;
        /** The raw SQS message. */
        message  : Message;
    }
}

export default WorkQueue;
