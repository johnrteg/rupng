//
// Kafka (MSK) facade — NOT an AWS SDK client: MSK speaks the Kafka wire protocol, so this
// wraps kafkajs. Topics are cloud-spec LOGICAL keys (CloudResolver -> topic name). Brokers
// come from env (KAFKA_BROKERS — the Redpanda side-container locally, the MSK broker list in
// the cloud). Real MSK auth (IAM/TLS/SASL) is configured here; local is PLAINTEXT.
//
import { Kafka as KafkaJS } from "kafkajs";
import type { Producer, Consumer, Message, EachMessagePayload, IHeaders } from "kafkajs";
import type { CloudResolver, ResourceKey } from "@repo/cloud-spec";
import { ResultUtils } from "@repo/common";
import type { Type } from "@repo/common";

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
 *     // publish* return a Result (no throw) — check `.ok`.
 *     async created( contact : Contact ) : Promise<void> {
 *         const published = await this.kafka.publishEvent( "contact", { type: "contact.created", key: contact.id, data: contact } );
 *         if ( !published.ok ) this.log.error( "publish failed", published.error );
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
    publish( topicKey : ResourceKey, messages : Array<Message> ) : Promise<Type.Result<void>>
    {
        return ResultUtils.from( async () : Promise<void> =>
        {
            if( this._producer === undefined )
            {
                this._producer = this.kafka.producer();
                await this._producer.connect();
            }
            await this._producer.send( { topic: this.topic( topicKey ), messages } );
        } );
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

    ////////////////////////////////////////////////////////////////////////////////////////////////////////
    /**
     * Publish a typed **event envelope** ({@link Kafka.Event}) to an **entity topic** — the
     * recommended shape for entity state-change streams. The envelope's `key` becomes the Kafka message
     * **key** (so all events for one entity share a partition and stay **ordered**), and the metadata
     * (`type` / `id` / `source` / `transactionId` / `version` / `seq`) is mirrored to **headers** for
     * cheap broker-side filtering. Consume with {@link subscribeEvents} or {@link subscribeObject}.
     *
     * @typeParam T the `data` payload shape.
     * @param topicKey logical topic key (one per entity, e.g. `"contact"`).
     * @param event    the {@link Kafka.Event} envelope.
     */
    publishEvent<T>( topicKey : ResourceKey, event : Kafka.Event<T> ) : Promise<Type.Result<void>>
    {
        const headers : Record<string, string> = { type: event.type };
        if( event.id            !== undefined ) headers[ "id" ]            = event.id;
        if( event.source        !== undefined ) headers[ "source" ]        = event.source;
        if( event.transactionId !== undefined ) headers[ "transactionId" ] = event.transactionId;
        if( event.version       !== undefined ) headers[ "version" ]       = String( event.version );
        if( event.seq           !== undefined ) headers[ "seq" ]           = String( event.seq );

        return this.publish( topicKey, [ { key: event.key, value: JSON.stringify( event ), headers } ] );
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
     * Subscribe and receive each message's **JSON-parsed value** typed as `T` — the consume-side
     * counterpart to {@link publishJson}. The handler gets the value plus the {@link Kafka.Incoming}
     * (for key/partition/headers). The value is parsed once in {@link subscribe} (a non-JSON message
     * throws there and is redelivered); same delivery + group semantics.
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
            handler( message.value as T, message ), opts );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////////////////
    /**
     * Subscribe to an **entity topic** and receive each {@link Kafka.Event} envelope typed — the
     * consume-side counterpart to {@link publishEvent}. `switch` on `event.type` in the handler. The
     * envelope is the already-parsed message value; same delivery + group semantics as {@link subscribe}
     * (at-least-once; throw to redeliver). Use {@link subscribeObject} to get the envelope **merged with**
     * the message metadata in one object.
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
            handler( message.value as Kafka.Event<T>, message ), opts );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////////////////
    /**
     * Subscribe to an **entity topic** and receive the {@link Kafka.Event} envelope **merged with** its
     * transport metadata as a single {@link Kafka.Received} object — `type` / `key` / `data` / `id` /
     * `time` / `source` / `transactionId` / `version` / `seq` / `changed` alongside
     * `topic` / `partition` / `headers` / `raw`. The ergonomic consume-side counterpart to
     * {@link publishEvent} when you want everything in one argument; same delivery + group semantics as
     * {@link subscribe} (at-least-once; throw to redeliver).
     *
     * @typeParam T the `data` payload shape.
     * @param handler async callback — receives one merged {@link Kafka.Received}.
     */
    async subscribeObject<T>(
        groupId   : string,
        topicKeys : ResourceKey | Array<ResourceKey>,
        handler   : ( received : Kafka.Received<T> ) => Promise<void>,
        opts      : Kafka.SubscribeOptions = {},
    ) : Promise<Consumer>
    {
        // envelope fields win on overlap (key, type); topic/partition/headers/raw come from the message
        return this.subscribe( groupId, topicKeys, ( message : Kafka.Incoming ) : Promise<void> =>
            handler( { ...message, ...( message.value as Kafka.Event<T> ) } ), opts );
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
     * Tear down **one** subscription created by {@link subscribe} — disconnects that {@link Consumer}
     * (leaving its group, triggering a partition rebalance) and stops tracking it, so {@link disconnect}
     * won't touch it again. The counterpart to a single {@link subscribe} call.
     *
     * **Kafka note:** there is no "drop a single topic from a live consumer" — a subscription *is* the
     * whole consumer, so this disconnects it. To merely *halt* consumption while keeping group
     * membership, use the returned `Consumer`'s `pause()`/`resume()` instead. For full shutdown of
     * everything, call {@link disconnect}.
     *
     * Mainly for **dynamic** subscribers (per-tenant/feature subscriptions that come and go, tests);
     * a service that subscribes once and runs for its lifetime just needs {@link disconnect}.
     * Idempotent — a consumer that isn't (or is no longer) tracked is ignored.
     *
     * @param consumer the {@link Consumer} returned by an earlier {@link subscribe} call.
     */
    async unsubscribe( consumer : Consumer ) : Promise<void>
    {
        const index : number = this._consumers.indexOf( consumer );
        if( index === -1 ) return;                  // not tracked (already torn down) — nothing to do
        this._consumers.splice( index, 1 );         // untrack first so disconnect() can't double-disconnect
        await consumer.disconnect();
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
     * A typed **event envelope** for an entity state-change stream ({@link Kafka.publishEvent} /
     * {@link Kafka.subscribeEvents} / {@link Kafka.subscribeObject}). `key` is the partition/ordering
     * key (one topic per entity, keyed by entity id → all of an entity's events stay ordered); `type`
     * is the verb to switch on. A lightweight CloudEvents-style envelope.
     *
     * `type`/`key`/`data` are always present; the metadata below is optional on the type but, by
     * **convention, required for state-change events** — see `aws/SPECS.md` → "Entity state-change
     * events". `publishEvent` mirrors `id`/`type`/`source`/`transactionId`/`version`/`seq` to headers
     * for broker-side filtering.
     *
     * This is the platform-wide {@link Type.MessageEnvelope} — the same body the WebSocket push frame
     * and the client pub/sub bus carry — with `key` re-required (Kafka needs it as the partition key).
     */
    export interface Event<T = unknown> extends Type.MessageEnvelope<T>
    {
        key : string;   // entity/ordering key (becomes the Kafka message key) — required on Kafka
    }

    /** A decoded inbound message handed to a {@link Kafka.subscribe} handler. */
    export interface Incoming
    {
        topic     : string;                    // resolved physical topic name the message came from
        partition : number;                    // source partition (ordering scope)
        key       : string | undefined;        // decoded message key (undefined if unkeyed)
        value     : any;                        // JSON-parsed message value (our topics are always JSON); undefined if empty. Raw bytes: `raw.message.value`
        headers   : Record<string, string>;    // decoded headers (e.g. transactionId, contentType)
        raw       : EachMessagePayload;         // escape hatch — original kafkajs payload (binary, ts, offset)
    }

    /**
     * The parsed {@link Event} envelope **merged with** its {@link Incoming} transport metadata — what a
     * {@link Kafka.subscribeObject} handler receives in a single object. Envelope fields win on overlap
     * (`key`, `type`); `topic`/`partition`/`value`/`headers`/`raw` come from the message.
     */
    export type Received<T = unknown> = Event<T> & Incoming;

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
