//
// Kafka (MSK) facade — NOT an AWS SDK client: MSK speaks the Kafka wire protocol, so this
// wraps kafkajs. Topics are cloud-spec LOGICAL keys (CloudResolver -> topic name). Brokers
// come from env (KAFKA_BROKERS — the Redpanda side-container locally, the MSK broker list in
// the cloud). Real MSK auth (IAM/TLS/SASL) is configured here; local is PLAINTEXT.
//
import { Kafka as KafkaJS } from "kafkajs";
import type { Producer, Consumer, Message, EachMessagePayload, IHeaders } from "kafkajs";
import type { CloudResolver, ResourceKey } from "@repo/cloud-spec";

/**
 * Kafka (MSK) facade — wraps `kafkajs` (MSK speaks the Kafka wire protocol, not an AWS SDK),
 * addressed by cloud-spec LOGICAL topic keys (e.g. `"events"`).
 *
 * **Use it for** high-throughput event streaming and pub/sub between services (durable,
 * replayable, ordered-per-partition). **Prefer something else when:** a simple point-to-point
 * work queue → SQS; fan-out notifications / scheduled events → SNS / EventBridge.
 *
 * Reach through `.client` for the admin API, transactions, or custom consumer configuration.
 *
 * ### Entity streams — prefer ONE topic + a typed {@link Kafka.Event} envelope
 * For an entity's lifecycle (`created` / `modified` / `deleted`), use **one topic per entity** (e.g.
 * `"contact"`), **key by the entity id**, and put the verb in an {@link Kafka.Event} envelope's
 * `type` — then `switch` on `type` in the consumer. *Don't* make a topic per verb
 * (`contact.created`, `contact.deleted`, …): Kafka only orders within a single topic-partition, so
 * splitting verbs across topics loses ordering for a given entity (a `deleted` could be processed
 * before its `modified`). One keyed topic keeps a contact's events strictly ordered, and a consumer
 * sees them all without topic wildcards. Use {@link publishEvent} / {@link subscribeEvents}.
 *
 * @example Entity events — one keyed topic, typed envelope, switch on `type`
 * ```ts
 * import { Service, Kafka } from "@repo/services";
 *
 * interface Contact { id : string; name : string; }
 *
 * class ContactStream extends Service {
 *     private _kafka? : Kafka;
 *     protected get kafka() : Kafka { return this._kafka ??= new Kafka( this.cloud ); }
 *
 *     // PRODUCE — one "contact" topic; key by contactId so a contact's events stay ordered.
 *     async created( contact : Contact ) : Promise<void> {
 *         await this.kafka.publishEvent( "contact", { type: "contact.created", key: contact.id, data: contact } );
 *     }
 *     async deleted( contactId : string ) : Promise<void> {
 *         await this.kafka.publishEvent( "contact", { type: "contact.deleted", key: contactId, data: { id: contactId } } );
 *     }
 *
 *     // CONSUME — subscribe ONCE to "contact"; branch on the envelope type (no wildcard topics).
 *     protected override async start() : Promise<void> {
 *         await this.kafka.subscribeEvents<Contact>( "contact-indexer", "contact", async ( event ) => {
 *             switch ( event.type ) {
 *                 case "contact.created":
 *                 case "contact.modified": await this.upsert( event.data ); break;
 *                 case "contact.deleted":  await this.remove( event.key );  break;
 *             }
 *             // returning normally COMMITS the offset; THROWING redelivers (at-least-once).
 *         } );
 *     }
 * }
 * ```
 *
 * For ad-hoc (non-entity) payloads, {@link publishJson} / {@link subscribeJson} send/parse a bare
 * value with an optional partition key.
 */
export class Kafka
{
    private readonly kafka : KafkaJS;
    private _producer? : Producer;
    private readonly _consumers : Array<Consumer> = [];

    ////////////////////////////////////////////////////////////////////////////////////////////////////////
    /**
     * @param cloud    the owning service's resolver — maps logical topic keys to topic names.
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
    /** Resolve a cloud-spec logical topic key (e.g. `"events"`) to its physical topic name. */
    topic( key : ResourceKey ) : string { return this.cloud.topicName( key ); }

    ////////////////////////////////////////////////////////////////////////////////////////////////////////
    /**
     * Publish messages to a topic. Reuses a single, lazily-connected producer.
     *
     * Set a message `key` when you need **per-key ordering** — all messages with the same key
     * land on one partition and are consumed in order (e.g. key by `accountId`). Leave it unset
     * for maximum throughput (round-robin across partitions, no ordering guarantee).
     *
     * @param topicKey logical topic key.
     * @param messages kafkajs messages (`{ key?, value, headers?, … }`).
     */
    async publish( topicKey : ResourceKey, messages : Array<Message> ) : Promise<void>
    {
        if( this._producer === undefined )
        {
            this._producer = this.kafka.producer();
            await this._producer.connect();
        }
        await this._producer.send( { topic: this.topic( topicKey ), messages } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////////////////
    /**
     * Publish one or more values as **JSON** — the common case. Each value is `JSON.stringify`d
     * into a message `value`; wraps {@link publish}.
     *
     * Pass `opts.key` to derive a **partition key** per value for per-key ordering (e.g.
     * `(e) => e.accountId`); `opts.headers` are applied to every message.
     *
     * @typeParam T the payload shape.
     * @param topicKey logical topic key.
     * @param payload  a single value or an array of values to publish.
     * @param opts     optional per-value `key` extractor + common `headers`.
     */
    async publishJson<T>( topicKey : ResourceKey, payload : T | Array<T>, opts : Kafka.PublishOptions<T> = {} ) : Promise<void>
    {
        const values   : Array<T>       = Array.isArray( payload ) ? payload : [ payload ];
        const messages : Array<Message> = values.map( ( value : T ) : Message => ( {
            key     : opts.key?.( value ),
            value   : JSON.stringify( value ),
            headers : opts.headers,
        } ) );
        await this.publish( topicKey, messages );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////////////////
    /**
     * Publish a typed **event envelope** ({@link Kafka.Event}) to an **entity topic** — the
     * recommended shape for entity lifecycle streams. The envelope's `key` becomes the Kafka message
     * **key** (so all events for one entity share a partition and stay **ordered**), and `type` is
     * also copied to a `type` **header** for cheap inspection. Consume with {@link subscribeEvents}.
     *
     * @typeParam T the `data` payload shape.
     * @param topicKey logical topic key (one per entity, e.g. `"contact"`).
     * @param event    the envelope: `{ type, key, data, id?, time?, source? }`.
     */
    async publishEvent<T>( topicKey : ResourceKey, event : Kafka.Event<T> ) : Promise<void>
    {
        const headers : Record<string, string> = { type: event.type };
        if( event.id !== undefined ) headers[ "id" ] = event.id;

        await this.publish( topicKey, [ { key: event.key, value: JSON.stringify( event ), headers } ] );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////////////////
    /**
     * Subscribe to one or more topics and invoke `handler` for **each message** — the consume-side
     * counterpart to {@link publish}. Creates a consumer in `groupId`, connects, subscribes to the
     * resolved topic(s), and starts the run loop; the returned {@link Consumer} is also tracked so
     * {@link disconnect} stops it on shutdown.
     *
     * **Delivery / offsets (at-least-once):** the offset is committed when `handler` **resolves**;
     * if it **throws**, kafkajs does not advance past the message and it is **redelivered** — so
     * handlers must be idempotent. Messages within a partition are processed **one at a time, in
     * order**; throughput scales by adding partitions and group members.
     *
     * **Group semantics:** members sharing a `groupId` **split** the topic's partitions (scale-out
     * — each message handled once across the group). An independent reader that needs its *own*
     * copy of the stream uses a **distinct** `groupId`.
     *
     * For batch processing, manual commit, or per-partition concurrency, use {@link consumer}
     * (the raw kafkajs consumer) instead.
     *
     * @param groupId   consumer-group id (load-balancing / offset-tracking scope).
     * @param topicKeys one logical topic key, or several to fan a single handler across topics.
     * @param handler   async per-message callback — receives a decoded {@link Kafka.Incoming}.
     * @param opts      `fromBeginning` replays the topic from offset 0 on first run (default: false,
     *                  i.e. only new messages once the group's offsets are committed).
     * @returns the running {@link Consumer} (for pause/resume/seek or manual disconnect).
     */
    async subscribe(
        groupId   : string,
        topicKeys : ResourceKey | Array<ResourceKey>,
        handler   : ( message : Kafka.Incoming ) => Promise<void>,
        opts      : Kafka.SubscribeOptions = {},
    ) : Promise<Consumer>
    {
        const keys     : Array<ResourceKey> = Array.isArray( topicKeys ) ? topicKeys : [ topicKeys ];
        const consumer : Consumer           = this.kafka.consumer( { groupId } );

        await consumer.connect();
        for( const key of keys )
            await consumer.subscribe( { topic: this.topic( key ), fromBeginning: opts.fromBeginning ?? false } );

        await consumer.run( {
            eachMessage : async ( payload : EachMessagePayload ) : Promise<void> =>
            {
                await handler( {
                    topic     : payload.topic,
                    partition : payload.partition,
                    key       : payload.message.key?.toString(),
                    value     : payload.message.value?.toString() ?? "",
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
     * Subscribe and receive each message's value **already `JSON.parse`d** — the consume-side
     * counterpart to {@link publishJson}. The handler gets the typed value plus the raw
     * {@link Kafka.Incoming} (for key/partition/headers). Same delivery + group semantics as
     * {@link subscribe}; a value that fails to parse throws (and is therefore redelivered).
     *
     * @typeParam T the expected payload shape.
     * @param handler async callback — receives the parsed value and the decoded message.
     */
    async subscribeJson<T>(
        groupId   : string,
        topicKeys : ResourceKey | Array<ResourceKey>,
        handler   : ( value : T, message : Kafka.Incoming ) => Promise<void>,
        opts      : Kafka.SubscribeOptions = {},
    ) : Promise<Consumer>
    {
        return this.subscribe( groupId, topicKeys, ( message : Kafka.Incoming ) : Promise<void> =>
            handler( JSON.parse( message.value ) as T, message ), opts );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////////////////
    /**
     * Subscribe to an **entity topic** and receive each {@link Kafka.Event} envelope parsed + typed —
     * the consume-side counterpart to {@link publishEvent}. `switch` on `event.type` in the handler.
     * Same delivery + group semantics as {@link subscribe} (at-least-once; throw to redeliver).
     *
     * @typeParam T the `data` payload shape.
     * @param handler async callback — receives the typed {@link Kafka.Event} and the raw {@link Kafka.Incoming}.
     */
    async subscribeEvents<T>(
        groupId   : string,
        topicKeys : ResourceKey | Array<ResourceKey>,
        handler   : ( event : Kafka.Event<T>, message : Kafka.Incoming ) => Promise<void>,
        opts      : Kafka.SubscribeOptions = {},
    ) : Promise<Consumer>
    {
        return this.subscribe( groupId, topicKeys, ( message : Kafka.Incoming ) : Promise<void> =>
            handler( JSON.parse( message.value ) as Kafka.Event<T>, message ), opts );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////////////////
    /**
     * The raw kafkajs {@link Consumer} for a group — the **escape hatch** when {@link subscribe}'s
     * per-message model isn't enough (batch consumption via `eachBatch`, manual offset commits,
     * `partitionsConsumedConcurrently`, seeking). The caller owns `connect`/`subscribe`/`run` and
     * is NOT tracked by {@link disconnect}.
     */
    consumer( groupId : string ) : Consumer
    {
        return this.kafka.consumer( { groupId } );
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
    /** Disconnect the shared producer + every {@link subscribe}d consumer — call on graceful shutdown. */
    async disconnect() : Promise<void>
    {
        if( this._producer !== undefined ) await this._producer.disconnect();
        await Promise.all( this._consumers.map( ( consumer : Consumer ) => consumer.disconnect() ) );
    }
}

export namespace Kafka
{
    /**
     * A typed **event envelope** for an entity stream ({@link Kafka.publishEvent} /
     * {@link Kafka.subscribeEvents}). `key` is the partition/ordering key (one topic per entity,
     * keyed by entity id → all of an entity's events stay ordered); `type` is the verb to switch on.
     */
    export interface Event<T = unknown>
    {
        type    : string;       // the event verb, e.g. "contact.created" | "contact.deleted"
        key     : string;       // entity/ordering key (becomes the Kafka message key)
        data    : T;            // the typed payload
        id?     : string;       // optional unique event id (dedup) — also sent as a `type`/`id` header
        time?   : string;       // optional ISO-8601 occurred-at
        source? : string;       // optional emitting service name
    }

    /** A decoded inbound message handed to a {@link Kafka.subscribe} handler. */
    export interface Incoming
    {
        topic     : string;                    // resolved physical topic name the message came from
        partition : number;                    // source partition (ordering scope)
        key       : string | undefined;        // decoded message key (undefined if unkeyed)
        value     : string;                    // decoded message value (UTF-8; JSON.parse if needed)
        headers   : Record<string, string>;    // decoded headers (e.g. transactionId, contentType)
        raw       : EachMessagePayload;         // escape hatch — original kafkajs payload (binary, ts, offset)
    }

    /** Options for {@link Kafka.subscribe}. */
    export interface SubscribeOptions
    {
        fromBeginning? : boolean;              // replay from offset 0 on first run (default: false)
    }

    /** Options for {@link Kafka.publishJson}. */
    export interface PublishOptions<T>
    {
        key?     : ( value : T ) => string;    // derive a partition key per value (per-key ordering)
        headers? : Record<string, string>;     // headers applied to every published message
    }
}
