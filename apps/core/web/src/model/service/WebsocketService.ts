//

//import ServerEvent from "@main/events/ServerEvent";
import ReconnectingWebSocket from "reconnecting-websocket";
import AppModel from "../AppModel";
import { NetworkUtils, ObjectUtils } from "@repo/common";
import type { Events } from "@repo/system";   // the universal event envelope (same body as Kafka + webhooks)



//
// WebSocketService — server → client live push (inbox/updates/notifications), routed to PubSubService.
// RECEIVE-ONLY by design: there is no client `send()`. Client actions go through the REST API, not the
// socket (avoids duplicating action-auth across two transports). See SPECS.md.
//
export class WebSocketService
{
    private appdata : AppModel;
    
    public socket       : ReconnectingWebSocket | null = null;
    private accountId   : string;
    
    //////////////////////////////////////////////////////////////////////////////////////////////////////////////
    constructor( app : AppModel )
    {
        this.appdata = app;
        this.accountId = "";

        this.onSocketOpen           = this.onSocketOpen.bind( this );
        this.onSocketError          = this.onSocketError.bind( this );
        this.onSocketClose          = this.onSocketClose.bind( this );
        this.onSocketMessage        = this.onSocketMessage.bind( this );
        //this.onAccountSyncEvent     = this.onAccountSyncEvent.bind( this );
        //this.onProjectSyncEvent     = this.onProjectSyncEvent.bind( this );
    }

    //////////////////////////////////////////////////////////////////////////////////////////////////////////////
    public makeEmpty() : void
    {
        this.closeSocket();
    }

    //////////////////////////////////////////////////////////////////////////////////////////////////
    /**
    * Closes the currently open web socket connection to the server
    *
    */
    private closeSocket() : void
    {
        if( this.socket !== null )
        {
            this.socket.removeEventListener( 'open', this.onSocketOpen );
            this.socket.removeEventListener( 'error', this.onSocketError );
            this.socket.removeEventListener( 'close', this.onSocketClose );
            this.socket.removeEventListener( 'message', this.onSocketMessage );
            this.socket.close();
            this.socket = null;
        }
    }

    //////////////////////////////////////////////////////////////////////////////////////////////////////////////
    public setAccountId( id : string ) : void
    {
        if( id !== this.accountId )
        {
            this.accountId = id;
            this.closeSocket();
            this.socketConnect();
        }
    }

    //////////////////////////////////////////////////////////////////////////////////////////////////
    /**
    * Callback funtion when the web socket connection was able to connect to the server
    *
    */
    private socketConnect() : void
    {
        // close any existing connection before going to another account
        this.closeSocket();

        const url : NetworkUtils.Url = NetworkUtils.parseUrl( window.document.URL );
       //console.log( 'socketConnect', url );

        // match ws or wss bases on current protocol
        const server : string = NetworkUtils.url( url.protocol === NetworkUtils.Protocol.HTTPS ? NetworkUtils.Protocol.WSS : NetworkUtils.Protocol.WS,
                                            url.domain,
                                            url.port,
                                            "/account/ws", { cid : this.accountId } );

        //console.log( 'socketConnect::server', server );

        // on local, limit the number of retires
        const dev : boolean = url.domain === "localhost";

        // https://github.com/pladaria/reconnecting-websocket
        this.socket = new ReconnectingWebSocket( server, [], { maxRetries: dev ? 3 : Infinity, debug : false } );
        this.socket.addEventListener( 'open', this.onSocketOpen );
        this.socket.addEventListener( 'error', this.onSocketError );
        this.socket.addEventListener( 'close', this.onSocketClose );
        this.socket.addEventListener( 'message', this.onSocketMessage );
    }

    //////////////////////////////////////////////////////////////////////////////////////////////////
    /**
    * Internal callback when the web socket was opend with the server
    *
    */
    private onSocketOpen( evt : any ) : void
    {
        //console.log( 'onSocketOpen', evt );
    }
    //////////////////////////////////////////////////////////////////////////////////////////////////
    /**
    * Internal callback when the client receives an error from the web socket server
    *
    */
    private onSocketError( evt : any ) : void
    {
        console.error( 'onSocketError', evt );
    }
    //////////////////////////////////////////////////////////////////////////////////////////////////
    /**
    * Internal callback the current web socket connection is closed.
    *
    */
    private onSocketClose( evt : any ) : void
    {
        //console.log( 'onSocketClose', evt );
    }
    //////////////////////////////////////////////////////////////////////////////////////////////////
    /**
    * Internal callback when an event is received from the web socket server.
    * @param event Event received from the server.
    *
    */
    private onSocketMessage( event : MessageEvent ) : void
    {
        this.processSocketMessage( event );
    }

    //////////////////////////////////////////////////////////////////////////////////////////////////
    /**
    * Process the event received from onSocketMessage to be distributed to the application
    * @param event Event received from AppData.onSocketMessage.
    *
    */
    private async processSocketMessage( event : MessageEvent ) : Promise<void>
    {
        // resolve the frame to text (server frames are JSON; binaryType defaults to Blob)
        let text : string | null = null;
        if( event.data instanceof Blob )            text = await event.data.text();
        else if( typeof event.data === "string" )   text = event.data;
        else
        {
            console.warn( "WebSocketService: unknown message format", event.constructor.name, event );
            return;
        }

        // safe parse — ObjectUtils.parseJSON returns null on bad JSON (no throw → no unhandled rejection
        // on a keepalive/ping or malformed frame).
        const message : WebSocketService.Message | null = ObjectUtils.parseJSON( text );
        if( message === null || !message.action )
        {
            console.warn( "WebSocketService: dropped non-JSON / actionless message", text );
            return;
        }

        // PHASE 1 — no per-type handling yet: every envelope is just logged, regardless of `action`. Once a
        // view needs to react to a specific event, subscribe it to `message.action` on the pubsub bus below.
        console.log( "WebSocketService: event", message );

        // publish the WHOLE envelope to subscribers (routed by `message.action` — `${object}.${verb}`) —
        // the bus carries the same body that arrived on the socket, so subscribers see the full envelope
        // (object/verb/eventId/actor/…), not just `data`. (Subscribe by action, or by object for all verbs.)
        this.appdata.pubsub.publish( message.action, message );
    }


    
}


export namespace WebSocketService
{
    /**
     * The push frame is the platform's **one universal event envelope**, {@link Events.Envelope} from
     * `@repo/system` — the **same body** the server publishes on Kafka and sends to outbound webhooks, and
     * which we re-publish on the client pub/sub bus (routed by `action`). Imported as a type only, so no
     * server/AWS code reaches the web bundle.
     */
    export type Message = Events.Envelope;
}

export default WebSocketService;

// eof