//
// PubSubService — a tiny in-memory, client-side event bus (component ↔ component within the SPA).
// Hand-rolled over Map<type, Set<callback>> — no dependency. (Distinct from the server-side Kafka bus.)
//
export class PubSubService
{
    private subscribers : Map<string, Set<PubSubService.Callback>>;

    constructor()
    {
        this.subscribers = new Map<string, Set<PubSubService.Callback>>();
    }

    public makeEmpty() : void
    {
        this.subscribers.clear();
    }

    public addSubscriber( type : string, callback : PubSubService.Callback ) : void
    {
        let set : Set<PubSubService.Callback> | undefined = this.subscribers.get( type );
        if( set === undefined )
        {
            set = new Set<PubSubService.Callback>();
            this.subscribers.set( type, set );
        }
        set.add( callback );   // Set dedupes — subscribing the same callback twice is a no-op
    }

    public removeSubscriber( type : string, callback : PubSubService.Callback ) : void
    {
        const set : Set<PubSubService.Callback> | undefined = this.subscribers.get( type );
        if( set === undefined ) return;
        set.delete( callback );
        if( set.size === 0 ) this.subscribers.delete( type );   // prune empty buckets
    }

    public refreshSubscriber( type : string, callback : PubSubService.Callback ) : void
    {
        this.removeSubscriber( type, callback );
        this.addSubscriber( type, callback );
    }

    public publish( type : string, data : PubSubService.Event ) : void
    {
        // copy before iterating so a handler that (un)subscribes during dispatch can't disrupt the loop
        const set : Set<PubSubService.Callback> | undefined = this.subscribers.get( type );
        if( set === undefined ) return;
        for( const callback of [ ...set ] ) callback( data );
    }

    public diagnose() : void
    {
        for( const [ type, callbacks ] of this.subscribers )
        {
            console.log( `Event: ${type}, Subscribers: ${callbacks.size}` );
        }
    }
}

export namespace PubSubService
{
    // The payload carried on the bus. `any` because the bus serves two origins with one API:
    //   • server signals  — the whole `Events.Envelope` from @repo/system (pushed by WebSocketService,
    //                        the SAME universal body Kafka published), routed by its `action`.
    //   • UI signals       — local app events keyed by the `Type` enum below (theme/route/…).
    // Kept untyped here (not imported) so this client bus stays dependency-light; subscribers narrow.
    export type Event = any;
    export type Callback = ( event : PubSubService.Event ) => void;

    //
    // UI driven events
    //
    export enum Type 
    {
        THEME           = "theme",
        LANGUAGE        = "language",
        ROUTE           = "route",      // route requested
        PATH           = "path",        // path changed
        HELP            = "help",
        PAYMENT = "payment",
        LOGIN = "login",
        ACCOUNT = "account",
        NOTICES = "notices",
        CHAT = "chat"                   // toggle the right-side chat panel (open ⇄ closed)
    }
}

export default PubSubService;

// eof
