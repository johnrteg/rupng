//
// Kafka (MSK) facade — NOT an AWS SDK client: MSK speaks the Kafka wire protocol, so this
// wraps kafkajs. Brokers come from env (KAFKA_BROKERS — the Redpanda side-container locally,
// the MSK broker list in the cloud). Real MSK auth (IAM/TLS/SASL) is configured here; local is PLAINTEXT.
//
// The event bus carries the platform's ONE universal body — `Events.Envelope` (@repo/events) — the
// SAME shape used for inter-service state change (here), the WebSocket push frame (server → client),
// and outbound webhooks. A state-change topic IS an `Events.Object` (`<service>.<noun>`); a consumer
// subscribes to the objects it cares about and switches on the envelope's `verb`. High-volume analytics
// ride an `Events.Stream` (behavior / engagement). See root SPECS → "Events & messaging".
//
import { Kafka as KafkaJS } from "kafkajs";
import type { Producer, Consumer, Message, EachMessagePayload, IHeaders } from "kafkajs";
import type { CloudResolver, ResourceKey } from "@repo/cloud-manifest";
import { ResultUtils } from "@repo/common";
import type { Type } from "@repo/common";
import type { Events } from "@repo/events";

/**
 * Kafka (MSK) facade — wraps `kafkajs` (MSK speaks the Kafka wire protocol, not an AWS SDK).
 *
 * **Use it for** high-throughput event streaming and pub/sub between services (durable, replayable,
 * ordered-per-partition). **Prefer something else when:** a simple point-to-point work queue → SQS;
 * fan-out notifications / scheduled events → SNS / EventBridge.
 *
 * Reach through `.client` for the admin API, transactions, or custom consumer configuration.
 *
 * ### Entity streams — one topic per `Events.Object`, switch on the `verb`
 * For an entity's lifecycle, publish/subscribe by its **`Events.Object`** (`<service>.<noun>`) — the topic
 * IS the object, keyed by the entity id so a given entity's events stay strictly ordered (Kafka only orders
 * within a topic-partition). A consumer subscribes to the objects it cares about and `switch`es on the
 * envelope's `verb` — never a topic-per-verb (that would split an entity's lifecycle across topics and lose
 * ordering). Use {@link publishEvent} / {@link subscribeEvents}.
 *
 * @example Entity events — typed envelope in, switch on `verb` out
 * ```ts
 * import { Service, Kafka } from "@repo/services";
 * import { Events } from "@repo/events";
 *
 * class ContactStream extends Service {
 *     private _kafka? : Kafka;
 *     protected get kafka() : Kafka { return this._kafka ??= new Kafka( this.cloud ); }
 *
 *     // PRODUCE — topic = envelope.object ("contact.contact"); keyed by the entity id (target.id).
 *     async changed( envelope : Events.Of<Events.Object.CONTACT_CONTACT> ) : Promise<void> {
 *         const published = await this.kafka.publishEvent( envelope );
 *         if ( !published.ok ) this.log.error( "publish failed", published.error );
 *     }
 *
 *     // CONSUME — subscribe to the object; branch on the verb.
 *     protected override async start() : Promise<void> {
 *         await this.kafka.subscribeEvents( "contact-indexer", Events.Object.CONTACT_CONTACT, async ( event ) => {
 *             switch ( event.verb ) {
 *                 case Events.Verb.CREATED:
 *                 case Events.Verb.UPDATED: await this.upsert( event.data ); break;
 *                 case Events.Verb.DELETED: await this.remove( event.target.id ); break;
 *             }
 *             // returning normally COMMITS the offset; THROWING redelivers (at-least-once).
 *         } );
 *     }
 * }
 * ```
 *
 * For analytics ingestion streams (behavior / engagement) use {@link publishStream} / {@link subscribeStream};
 * for ad-hoc payloads on a raw topic, {@link publishJson} / {@link subscribeJson}.
 */
export class Kafka
{
    private readonly kafka : KafkaJS;
    private _producer? : Producer;
    private readonly _consumers : Array<Consumer> = [];

    ////////////////////////////////////////////////////////////////////////////////////////////////////////
    /**
     * @param cloud    the owning service's resolver — maps logical topic keys to names (for the raw
     *                 {@link publish}/{@link subscribe} path; event topics are addressed by `Events.Object`).
     * @param brokers  broker list (defaults to `KAFKA_BROKERS`, comma-separated).
     * @param clientId stable client id shown in broker logs/metrics (defaults to `SERVICE_NAME`).
     */
    constructor(
        private readonly cloud : CloudResolver,
        brokers  : Array<string> = ( process.env.KAFKA_BROKERS ?? "" ).split( "," ).map( ( s ) => s.trim() ).filter( Boolean ),
        clientId : string = process.env.SERVICE_NAME ?? "rup-service",
    )
    {
        // MSK in AWS uses IAM/TLS/SASL; locally (Redpanda) it's PLAINTEXT. Auth config goes here.
        this.kafka = new KafkaJS( { clientId, brokers } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////////////////
    /** The raw `kafkajs` instance — escape hatch (admin API, transactions, custom consumers). */
    get client() : KafkaJS { return this.kafka; }

    ////////////////////////////////////////////////////////////////////////////////////////////////////////
    /** Resolve a cloud-manifest logical topic key to its physical name (for the raw publish/subscribe path). */
    topic( key : ResourceKey ) : string { return this.cloud.topicName( key ); }

    // ── Publish ─────────────────────────────────────────────────────────────────────────────────────────

    ////////////////////////////////////////////////////////////////////////////////////////////////////////
    /** Send messages to a topic by NAME, reusing a single, lazily-connected producer. */
    private publishTo( topicName : string, messages : Array<Message> ) : Promise<Type.Result<void>>
    {
        return ResultUtils.from( async () : Promise<void> =>
        {
            if( this._producer === undefined )
            {
                this._producer = this.kafka.producer();
                await this._producer.connect();
            }
            await this._producer.send( { topic: topicName, messages } );
        } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////////////////
    /**
     * Publish raw messages to a topic addressed by cloud-manifest logical key. The escape hatch for
     * bespoke payloads/keying; for events prefer {@link publishEvent}, for analytics {@link publishStream}.
     */
    publish( topicKey : ResourceKey, messages : Array<Message> ) : Promise<Type.Result<void>>
    {
        return this.publishTo( this.topic( topicKey ), messages );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////////////////
    /**
     * Publish a typed **event** — an {@link Events.Envelope} — to its entity topic. The topic IS
     * `envelope.object` (`<service>.<noun>`); the Kafka message **key** is the entity id
     * (`envelope.target.id`), so all of an entity's events share a partition and stay **ordered**. The
     * routing fields (`object` / `verb` / `action` / `eventId` / `accountId` / `version`) are mirrored to
     * **headers** for cheap broker-side filtering. The body is the universal envelope — the same shape the
     * WebSocket push frame and outbound webhooks carry. Consume with {@link subscribeEvents}.
     *
     * @param envelope the event to publish (build a typed `Events.Of<O>` so `data` matches the object).
     */
    publishEvent( envelope : Events.Envelope ) : Promise<Type.Result<void>>
    {
        const headers : Record<string, string> = {
            object    : envelope.object,
            verb      : envelope.verb,
            action    : envelope.action,
            eventId   : envelope.eventId,
            accountId : envelope.accountId,
            version   : envelope.version,
        };
        return this.publishTo( envelope.object, [ { key: envelope.target.id, value: JSON.stringify( envelope ), headers } ] );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////////////////
    /**
     * Publish to an **analytics ingestion stream** ({@link Events.Stream} — `BEHAVIOR` / `ENGAGEMENT`):
     * high-volume telemetry whose sole consumer is analytics (NOT per-entity state change). Each value is
     * JSON-encoded; pass `opts.key` to derive a partition key for per-key ordering.
     *
     * @typeParam T the telemetry shape.
     */
    publishStream<T>( stream : Events.Stream, payload : T | Array<T>, opts : Kafka.PublishOptions<T> = {} ) : Promise<Type.Result<void>>
    {
        const values   : Array<T>       = Array.isArray( payload ) ? payload : [ payload ];
        const messages : Array<Message> = values.map( ( value : T ) : Message => ( {
            key     : opts.key?.( value ),
            value   : JSON.stringify( value ),
            headers : opts.headers,
        } ) );
        return this.publishTo( stream as unknown as string, messages );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////////////////
    /**
     * Publish one or more values as **JSON** to a raw topic (by logical key) — the ad-hoc escape hatch.
     * `opts.key` derives a partition key per value; `opts.headers` apply to every message.
     *
     * @typeParam T the payload shape.
     */
    publishJson<T>( topicKey : ResourceKey, payload : T | Array<T>, opts : Kafka.PublishOptions<T> = {} ) : Promise<Type.Result<void>>
    {
        const values   : Array<T>       = Array.isArray( payload ) ? payload : [ payload ];
        const messages : Array<Message> = values.map( ( value : T ) : Message => ( {
            key     : opts.key?.( value ),
            value   : JSON.stringify( value ),
            headers : opts.headers,
        } ) );
        return this.publish( topicKey, messages );
    }

    // ── Subscribe ───────────────────────────────────────────────────────────────────────────────────────

    ////////////////////////////////////////////////////////////////////////////////////////////////////////
    /**
     * Core consume loop: create a consumer in `groupId`, subscribe to the given topic NAMES, and invoke
     * `handler` for each decoded message. At-least-once — the offset commits when `handler` resolves; a
     * throw leaves it uncommitted (redelivered), so handlers must be idempotent. The {@link Consumer} is
     * tracked so {@link disconnect} stops it.
     */
    private async runConsumer(
                        groupId    : string,
                        topicNames : Array<string>,
                        handler    : ( message : Kafka.Incoming ) => Promise<void>,
                        opts       : Kafka.SubscribeOptions = {},
                    ) : Promise<Consumer>
    {
        const consumer : Consumer = this.kafka.consumer( { groupId } );

        await consumer.connect();
        for( const name of topicNames )
            await consumer.subscribe( { topic: name, fromBeginning: opts.fromBeginning ?? false } );

        await consumer.run( {
            eachMessage : async ( payload : EachMessagePayload ) : Promise<void> =>
            {
                await handler( {
                    topic     : payload.topic,
                    partition : payload.partition,
                    key       : payload.message.key?.toString(),
                    value     : Kafka.decodeValue( payload.message.value ),   // JSON-parsed (our topics are always JSON)
                    headers   : Kafka.decodeHeaders( payload.message.headers ),
                    raw       : payload,
                } );
            },
        } );

        this._consumers.push( consumer );
        return consumer;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////////////////
    /**
     * Subscribe to one or more **entity topics** by {@link Events.Object} and receive each
     * {@link Events.Envelope} typed as {@link Events.Of} — `switch` on `event.verb` in the handler. Members
     * sharing a `groupId` split the partitions (scale-out, each event handled once); a distinct `groupId`
     * gets its own copy of the stream. At-least-once (throw to redeliver).
     *
     * @typeParam O the object(s) subscribed to — `event.data` is typed via `PayloadFor<O>`.
     * @param groupId consumer-group id.
     * @param objects one `Events.Object`, or several to fan a single handler across entity topics.
     * @param handler async callback — receives the typed envelope and the raw {@link Kafka.Incoming}.
     */
    async subscribeEvents<O extends Events.Object>(
        groupId : string,
        objects : O | Array<O>,
        handler : ( event : Events.Of<O>, message : Kafka.Incoming ) => Promise<void>,
        opts    : Kafka.SubscribeOptions = {},
    ) : Promise<Consumer>
    {
        const names : Array<string> = ( Array.isArray( objects ) ? objects : [ objects ] ) as unknown as Array<string>;
        return this.runConsumer( groupId, names, ( message : Kafka.Incoming ) : Promise<void> =>
            handler( message.value as Events.Of<O>, message ), opts );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////////////////
    /**
     * Subscribe to an **analytics ingestion stream** ({@link Events.Stream}) and receive each JSON value
     * typed as `T`. The consume-side counterpart to {@link publishStream}; same delivery + group semantics.
     *
     * @typeParam T the telemetry shape.
     */
    async subscribeStream<T>(
        groupId : string,
        stream  : Events.Stream,
        handler : ( value : T, message : Kafka.Incoming ) => Promise<void>,
        opts    : Kafka.SubscribeOptions = {},
    ) : Promise<Consumer>
    {
        return this.runConsumer( groupId, [ stream as unknown as string ], ( message : Kafka.Incoming ) : Promise<void> =>
            handler( message.value as T, message ), opts );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////////////////
    /**
     * Subscribe to raw topic(s) by logical key and receive each decoded {@link Kafka.Incoming} — the escape
     * hatch for non-event topics. For entity events use {@link subscribeEvents}; for analytics {@link subscribeStream}.
     */
    async subscribe(
        groupId   : string,
        topicKeys : ResourceKey | Array<ResourceKey>,
        handler   : ( message : Kafka.Incoming ) => Promise<void>,
        opts      : Kafka.SubscribeOptions = {},
    ) : Promise<Consumer>
    {
        const keys  : Array<ResourceKey> = Array.isArray( topicKeys ) ? topicKeys : [ topicKeys ];
        const names : Array<string>      = keys.map( ( key : ResourceKey ) : string => this.topic( key ) );
        return this.runConsumer( groupId, names, handler, opts );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////////////////
    /**
     * Subscribe to raw topic(s) by logical key and receive each message's **JSON-parsed value** typed as
     * `T` (plus the {@link Kafka.Incoming}). The ad-hoc counterpart to {@link publishJson}.
     *
     * @typeParam T the expected payload shape.
     */
    async subscribeJson<T>(
        groupId   : string,
        topicKeys : ResourceKey | Array<ResourceKey>,
        handler   : ( value : T, message : Kafka.Incoming ) => Promise<void>,
        opts      : Kafka.SubscribeOptions = {},
    ) : Promise<Consumer>
    {
        return this.subscribe( groupId, topicKeys, ( message : Kafka.Incoming ) : Promise<void> =>
            handler( message.value as T, message ), opts );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////////////////
    /**
     * The raw kafkajs {@link Consumer} for a group — the **escape hatch** when the per-message model isn't
     * enough (batch via `eachBatch`, manual commits, `partitionsConsumedConcurrently`, seeking). The caller
     * owns `connect`/`subscribe`/`run` and is NOT tracked by {@link disconnect}.
     */
    consumer( groupId : string ) : Consumer
    {
        return this.kafka.consumer( { groupId } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////////////////
    /**
     * Decode + **`JSON.parse`** a message value (our topics are always JSON). Returns `undefined` for an
     * empty/absent value (e.g. a tombstone). A non-JSON value throws — which, inside the run loop, leaves
     * the offset uncommitted so the message is redelivered (at-least-once). For raw bytes use `Incoming.raw`.
     */
    private static decodeValue( value : Buffer | null | undefined ) : any
    {
        const text : string | undefined = value?.toString();
        return text !== undefined && text.length > 0 ? JSON.parse( text ) : undefined;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////////////////
    /** Decode kafkajs message headers (Buffer/array values) to a flat string map for handlers. */
    private static decodeHeaders( headers : IHeaders | undefined ) : Record<string, string>
    {
        const out : Record<string, string> = {};
        if( headers === undefined ) return out;

        for( const [ key, value ] of Object.entries( headers ) )
        {
            if( value === undefined ) continue;
            const first : Buffer | string | undefined = Array.isArray( value ) ? value[ 0 ] : value;
            out[ key ] = first?.toString() ?? "";
        }
        return out;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////////////////
    /**
     * Tear down **one** subscription — disconnects that {@link Consumer} (leaving its group, triggering a
     * rebalance) and stops tracking it. To merely *halt* consumption while keeping group membership, use the
     * returned `Consumer`'s `pause()`/`resume()`. Idempotent — an untracked consumer is ignored.
     */
    async unsubscribe( consumer : Consumer ) : Promise<void>
    {
        const index : number = this._consumers.indexOf( consumer );
        if( index === -1 ) return;                  // not tracked (already torn down) — nothing to do
        this._consumers.splice( index, 1 );         // untrack first so disconnect() can't double-disconnect
        await consumer.disconnect();
    }

    ////////////////////////////////////////////////////////////////////////////////////////////////////////
    /** Disconnect the shared producer + every subscribed consumer — call on graceful shutdown. */
    async disconnect() : Promise<void>
    {
        if( this._producer !== undefined ) await this._producer.disconnect();
        await Promise.all( this._consumers.map( ( consumer : Consumer ) => consumer.disconnect() ) );
    }
}

export namespace Kafka
{
    /** A decoded inbound message handed to a subscribe handler. */
    export interface Incoming
    {
        topic     : string;                    // resolved physical topic name the message came from
        partition : number;                    // source partition (ordering scope)
        key       : string | undefined;        // decoded message key (undefined if unkeyed)
        value     : any;                        // JSON-parsed message value (our topics are always JSON); undefined if empty. Raw bytes: `raw.message.value`
        headers   : Record<string, string>;    // decoded headers (object/verb/action/eventId/…)
        raw       : EachMessagePayload;         // escape hatch — original kafkajs payload (binary, ts, offset)
    }

    /** Options for {@link Kafka.subscribe} / {@link Kafka.subscribeEvents} / {@link Kafka.subscribeStream}. */
    export interface SubscribeOptions
    {
        fromBeginning? : boolean;              // replay from offset 0 on first run (default: false)
    }

    /** Options for {@link Kafka.publishStream} / {@link Kafka.publishJson}. */
    export interface PublishOptions<T>
    {
        key?     : ( value : T ) => string;    // derive a partition key per value (per-key ordering)
        headers? : Record<string, string>;     // headers applied to every published message
    }
}
