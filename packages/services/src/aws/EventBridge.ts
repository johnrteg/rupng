//
// EventBridge facade — emit domain events, keyed by cloud-manifest LOGICAL event-bus keys.
//
import { EventBridgeClient, PutEventsCommand } from "@aws-sdk/client-eventbridge";
import type { CloudResolver, ResourceKey } from "@repo/cloud-manifest";
import { ResultUtils } from "@repo/common";
import type { Type } from "@repo/common";
import { ClientUtils } from "./ClientUtils";

export class EventBridge
{
    private _client? : EventBridgeClient;

    ////////////////////////////////////////////////////////////////////////////////
    /** @param cloud the owning service's resolver — maps logical event-bus keys to bus names. */
    constructor( private readonly cloud : CloudResolver ) {}

    ////////////////////////////////////////////////////////////////////////////////
    /** The raw `EventBridgeClient` — escape hatch (rules, targets, archives). Lazy + cached. */
    get client() : EventBridgeClient { return this._client ??= ClientUtils.createClient( EventBridgeClient ); }

    ////////////////////////////////////////////////////////////////////////////////
    /** Resolve a cloud-manifest logical event-bus key (e.g. `"bus"`) to its physical bus name. */
    bus( key : ResourceKey ) : string { return this.cloud.eventBusName( key ); }

    ////////////////////////////////////////////////////////////////////////////////
    /**
     * Emit a domain event onto the bus. EventBridge **rules** then route it to targets (queues,
     * Lambdas, other buses) by matching `source` + `detailType` — publisher and subscribers stay
     * decoupled. Prefer this over {@link Sns} when routing/filtering or many event types share a
     * bus; prefer SNS for plain fan-out and {@link Sqs} for a single durable work queue.
     * @param busKey logical event-bus key.
     * @param event  `source` (e.g. `"campaign"`), `detailType` (e.g. `"CampaignSent"`), `detail` (payload).
     */
    put( busKey : ResourceKey, event : EventBridge.Event ) : Promise<Type.Result<void>>
    {
        return this.putMany( busKey, [ event ] );
    }

    ////////////////////////////////////////////////////////////////////////////////
    /** Emit several events in one call (≤ 10 — the PutEvents limit). */
    putMany( busKey : ResourceKey, events : Array<EventBridge.Event> ) : Promise<Type.Result<void>>
    {
        return ResultUtils.from( async () : Promise<void> =>
        {
            const bus : string = this.bus( busKey );
            await this.client.send( new PutEventsCommand( {
                Entries: events.map( ( e ) => ( {
                    EventBusName : bus,
                    Source       : e.source,
                    DetailType   : e.detailType,
                    Detail       : JSON.stringify( e.detail ),
                } ) ),
            } ) );
        } );
    }
}

export namespace EventBridge
{
    /** A domain event to put on the bus. `detail` is the JSON-serializable payload. */
    export interface Event
    {
        source     : string;       // emitting domain, e.g. "campaign"
        detailType : string;       // event name, e.g. "CampaignSent"
        detail     : object;       // payload (serialized to JSON)
    }
}
