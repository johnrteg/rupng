import { EventEmitter } from "node:events";
import { Kafka, type Consumer, type Admin, type EachMessagePayload } from "kafkajs";

import type { MonitorEvent, MonitorState, MonitorSync, MonitorTopology } from "../shared/types";
import { TOPOLOGY, publisherOf, subscriberGroupsOf } from "../shared/monitorTopology";

//
// KafkaMonitor — the console's read-only window onto the event bus (the Monitor → Events sub-tab).
//
// It's an independent kafkajs consumer over the topology's topics (the Events.Object/Stream names). Every
// message becomes a `MonitorEvent` (enriched with publisher + subscriber groups + payload size) and is
// pushed live to the renderer. A periodic poll of each SUBSCRIBER group's committed offsets tells us when
// an event has actually been consumed by every subscriber — at which point it drops into the "bin"
// (`finishedAt` set). Everything ages out of the in-memory window after a configurable TTL.
//
// Best-effort throughout: if Redpanda/MSK is unreachable the monitor reports an error and stays idle; it
// never throws into the app.
//

const DEFAULT_TTL_MS : number = 15 * 60_000;        // 15 minutes
const MAX_TTL_MS      : number = 60 * 60_000;        // 1 hour cap
const MIN_TTL_MS      : number = 60_000;             // 1 minute floor
const POLL_MS         : number = 1_500;              // offset-lag + prune cadence
const GROUP_ID        : string = "rup-console-monitor";

class KafkaMonitor extends EventEmitter
{
    private kafka?    : Kafka;
    private consumer? : Consumer;
    private admin?    : Admin;
    private poll?     : ReturnType<typeof setInterval>;

    private running : boolean = false;
    private error?  : string;
    private brokers : string = "";
    private ttlMs   : number = DEFAULT_TTL_MS;

    private readonly events : Map<string, MonitorEvent> = new Map();

    // ── lifecycle ────────────────────────────────────────────────────────────────────────────────
    /** Connect the consumer + admin, subscribe to topology topics, and begin the reconcile poll. Idempotent and best-effort: on failure it records the error and tears down. */
    async start() : Promise<MonitorState>
    {
        if ( this.running ) return this.state();

        this.brokers = ( process.env.KAFKA_BROKERS ?? "localhost:9092" ).split( "," ).map( ( broker ) => broker.trim() ).filter( Boolean ).join( "," );
        this.error = undefined;

        try
        {
            const brokerList : Array<string> = this.brokers.split( "," ).filter( Boolean );
            this.kafka    = new Kafka( { clientId: "rup-console-monitor", brokers: brokerList } );
            this.consumer = this.kafka.consumer( { groupId: GROUP_ID } );
            this.admin    = this.kafka.admin();

            await this.consumer.connect();
            await this.admin.connect();
            for ( const topic of TOPOLOGY.topics )
                await this.consumer.subscribe( { topic, fromBeginning: false } );

            await this.consumer.run( { eachMessage: ( payload : EachMessagePayload ) => this.onMessage( payload ) } );

            this.poll = setInterval( () => { void this.reconcile(); }, POLL_MS );
            this.running = true;
        }
        catch ( err )
        {
            this.error = ( err as Error ).message;
            await this.teardown();
        }
        return this.state();
    }

    /** Stop the monitor: tear down connections/timers and mark it not running. */
    async stop() : Promise<void>
    {
        await this.teardown();
        this.running = false;
    }

    /** Release all external resources (poll timer, consumer, admin) and clear the client handles. Safe to call repeatedly. */
    private async teardown() : Promise<void>
    {
        if ( this.poll ) { clearInterval( this.poll ); this.poll = undefined; }
        try { await this.consumer?.disconnect(); } catch { /* already gone */ }
        try { await this.admin?.disconnect(); }    catch { /* already gone */ }
        this.consumer = undefined;
        this.admin = undefined;
        this.kafka = undefined;
    }

    /** Empty the in-memory event window. */
    clear() : void { this.events.clear(); }

    /** Set the in-memory window TTL, clamped to the supported [ MIN_TTL_MS, MAX_TTL_MS ] range. */
    setTtl( ms : number ) : void
    {
        this.ttlMs = Math.max( MIN_TTL_MS, Math.min( MAX_TTL_MS, Math.round( ms ) ) );
    }

    /** Snapshot the current monitor state (status, brokers, topology, live events, TTL) for the renderer. */
    state() : MonitorState
    {
        return {
            running:  this.running,
            brokers:  this.brokers,
            error:    this.error,
            topology: TOPOLOGY as MonitorTopology,
            events:   [ ...this.events.values() ],
            ttlMs:    this.ttlMs,
            maxTtlMs: MAX_TTL_MS,
        };
    }

    // ── ingest ───────────────────────────────────────────────────────────────────────────────────
    /** Handle one consumed kafka message: parse its JSON envelope, build an enriched MonitorEvent, store it, and emit it live. Non-JSON / empty messages are ignored. */
    private async onMessage( payload : EachMessagePayload ) : Promise<void>
    {
        const text : string | undefined = payload.message.value?.toString();
        if ( !text ) return;

        let envelope : Record<string, unknown>;
        try { envelope = JSON.parse( text ) as Record<string, unknown>; }
        catch { return; }   // non-JSON message — ignore (our topics are JSON envelopes)

        const topic : string = payload.topic;
        const data  : unknown = ( envelope as { data? : unknown } ).data;
        const target : { type? : string; id? : string } = ( envelope as { target? : { type? : string; id? : string } } ).target ?? {};

        const event : MonitorEvent =
        {
            eventId:     String( ( envelope as { eventId? : string } ).eventId ?? `${topic}#${payload.partition}#${payload.message.offset}` ),
            topic,
            verb:        String( ( envelope as { verb? : string } ).verb ?? "" ),
            action:      String( ( envelope as { action? : string } ).action ?? topic ),
            accountId:   String( ( envelope as { accountId? : string } ).accountId ?? "" ),
            targetType:  String( target.type ?? "" ),
            targetId:    String( target.id ?? "" ),
            publisher:   publisherOf( topic ) ?? "?",
            subscribers: subscriberGroupsOf( topic ),
            occurredAt:  String( ( envelope as { occurredAt? : string } ).occurredAt ?? "" ),
            arrivedAt:   Date.now(),
            partition:   payload.partition,
            offset:      payload.message.offset,
            sizeBytes:   data === undefined ? 0 : Buffer.byteLength( JSON.stringify( data ) ),
            envelope,
            delivered:   [],
        };

        this.events.set( event.eventId, event );
        this.emit( "event", event );
    }

    // ── reconcile: subscriber delivery (→ bin) + TTL prune ─────────────────────────────────────────
    /** Periodic pass: mark events delivered once every subscriber group has committed past them (moving them to the "bin"), then prune anything older than the TTL. Emits a `sync` with the deltas. */
    private async reconcile() : Promise<void>
    {
        const now : number = Date.now();
        const sync : MonitorSync = { delivered: [], removed: [] };

        // 1) delivery — for each subscriber group, read committed offsets; an event is "delivered" to a
        //    group once that group has committed PAST its (topic, partition, offset).
        const committed : Map<string, number> = await this.committedOffsets();   // key: `${group}|${topic}|${partition}`
        for ( const event of this.events.values() )
        {
            if ( event.finishedAt ) continue;
            const groups : Array<string> = event.subscribers;
            if ( groups.length === 0 ) continue;   // no subscribers → never "finished" (just ages out of the live pool)

            const before : number = event.delivered.length;
            for ( const group of groups )
            {
                if ( event.delivered.includes( group ) ) continue;
                // committed offset is the NEXT offset the group will read; strictly greater than this
                // event's offset means the group has already consumed (and committed) this event.
                const committedOffset : number | undefined = committed.get( `${group}|${event.topic}|${event.partition}` );
                if ( committedOffset !== undefined && committedOffset > Number( event.offset ) ) event.delivered.push( group );
            }
            const finished : boolean = groups.every( ( group ) => event.delivered.includes( group ) );
            if ( finished ) event.finishedAt = now;

            if ( finished || event.delivered.length !== before )
                sync.delivered.push( { eventId: event.eventId, delivered: [ ...event.delivered ], finishedAt: event.finishedAt } );
        }

        // 2) prune — drop anything older than the TTL (single clock on arrival, covers live + bin).
        for ( const [ id, event ] of this.events )
            if ( now - event.arrivedAt > this.ttlMs ) { this.events.delete( id ); sync.removed.push( id ); }

        if ( sync.delivered.length > 0 || sync.removed.length > 0 ) this.emit( "sync", sync );
    }

    /** Committed offsets across all subscriber groups → `${group}|${topic}|${partition}` → nextOffset. */
    private async committedOffsets() : Promise<Map<string, number>>
    {
        const out : Map<string, number> = new Map();
        if ( !this.admin ) return out;

        const groups : Set<string> = new Set<string>();
        for ( const topic of TOPOLOGY.topics ) for ( const group of subscriberGroupsOf( topic ) ) groups.add( group );

        for ( const group of groups )
        {
            try
            {
                const topicOffsetsList = await this.admin.fetchOffsets( { groupId: group, topics: TOPOLOGY.topics } );
                for ( const topicOffsets of topicOffsetsList )
                    for ( const partition of topicOffsets.partitions )
                        // "-1" / undefined means the group has no committed offset for this partition — skip it.
                        if ( partition.offset !== undefined && partition.offset !== "-1" )
                            out.set( `${group}|${topicOffsets.topic}|${partition.partition}`, Number( partition.offset ) );
            }
            catch { /* group may not exist yet (subscriber not running) — skip */ }
        }
        return out;
    }
}

export const kafkaMonitor = new KafkaMonitor();
