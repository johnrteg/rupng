//
import ReconnectingWebSocket from "reconnecting-websocket";
import AppModel from "../AppModel";
import { NetworkUtils, ObjectUtils } from "@repo/common";
import { Collab } from "@repo/api";

//
// CollabSocketService — the live session for ONE OPEN collab room. Unlike `WebSocketService` (realtime's
// single, account-wide, RECEIVE-ONLY socket), this is instantiated per-open-room and is NOT receive-only —
// it also SENDS `chat.send`/`presence.status` frames. See apps/core/collab/SPECS.md's "separate client" note.
//
// A native browser WebSocket can't set custom headers, so both the (unverified-for-now, see
// CollabRoomServer's flagged security gap) auth token and the acting account travel as query params — the
// SAME convention `WebSocketService` already uses for its own `?cid=`.
//
export class CollabSocketService
{
    private readonly appdata : AppModel;
    private readonly roomId  : string;
    public socket : ReconnectingWebSocket | null = null;

    ////////////////////////////////////////////////////////////////////////////////////////////
    constructor( app : AppModel, roomId : string )
    {
        this.appdata = app;
        this.roomId  = roomId;

        this.onOpen    = this.onOpen.bind( this );
        this.onError   = this.onError.bind( this );
        this.onClose   = this.onClose.bind( this );
        this.onMessage = this.onMessage.bind( this );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** The pubsub event a room's frames are republished on — subscribe a `<Subscriber>` to this to react to
     *  `chat.message`/`presence.join`/`presence.leave`/`evict`/`error` for THIS room. */
    public static topicFor( roomId : string ) : string { return `collab.room.${ roomId }`; }

    ////////////////////////////////////////////////////////////////////////////////////////////
    public connect() : void
    {
        this.disconnect();

        const url : NetworkUtils.Url = NetworkUtils.parseUrl( window.document.URL );
        const token : string = this.appdata.auth.login?.token ?? "";
        const accountId : string = this.appdata.account.current?.accountId ?? "";

        const server : string = NetworkUtils.url(
            url.protocol === NetworkUtils.Protocol.HTTPS ? NetworkUtils.Protocol.WSS : NetworkUtils.Protocol.WS,
            url.domain, url.port, `/collab/rooms/${ this.roomId }/ws`, { token, account: accountId },
        );

        const dev : boolean = url.domain === "localhost";
        this.socket = new ReconnectingWebSocket( server, [], { maxRetries: dev ? 3 : Infinity, debug: false } );
        this.socket.addEventListener( "open", this.onOpen );
        this.socket.addEventListener( "error", this.onError );
        this.socket.addEventListener( "close", this.onClose );
        this.socket.addEventListener( "message", this.onMessage );
    }

    public disconnect() : void
    {
        if( this.socket === null ) return;
        this.socket.removeEventListener( "open", this.onOpen );
        this.socket.removeEventListener( "error", this.onError );
        this.socket.removeEventListener( "close", this.onClose );
        this.socket.removeEventListener( "message", this.onMessage );
        this.socket.close();
        this.socket = null;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** Send a chat message — the room server persists it + fans it back out as `chat.message` (including to
     *  this client, so the composer doesn't optimistically render its own send). */
    public sendChat( text : string ) : void
    {
        this.send( { op: "chat.send", text } );
    }

    /** Report this client's active/idle signal (from `useActivityStatus`) — send only on CHANGE, not
     *  continuously (the caller is responsible for de-duplicating). */
    public sendPresenceStatus( status : Collab.PresenceStatus.ACTIVE | Collab.PresenceStatus.IDLE ) : void
    {
        this.send( { op: "presence.status", status } );
    }

    private send( frame : CollabSocketService.ClientFrame ) : void
    {
        if( this.socket === null ) return;
        this.socket.send( JSON.stringify( frame ) );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    private onOpen() : void {}
    private onError( event : unknown ) : void { console.error( "CollabSocketService: socket error", event ); }
    private onClose() : void {}

    private onMessage( event : MessageEvent ) : void { void this.processMessage( event ); }

    private async processMessage( event : MessageEvent ) : Promise<void>
    {
        let text : string | null = null;
        if( event.data instanceof Blob )          text = await event.data.text();
        else if( typeof event.data === "string" ) text = event.data;
        else return;

        const frame : CollabSocketService.ServerFrame | null = ObjectUtils.parseJSON( text );
        if( frame === null || !frame.op || frame.op === "pong" ) return;   // keepalive — nothing to publish

        this.appdata.pubsub.publish( CollabSocketService.topicFor( this.roomId ), frame );
    }
}

export namespace CollabSocketService
{
    export type ClientFrame =
        | { op : "ping" }
        | { op : "chat.send"; text : string }
        | { op : "presence.status"; status : Collab.PresenceStatus.ACTIVE | Collab.PresenceStatus.IDLE };

    export type ServerFrame =
        | { op : "pong" }
        | { op : "chat.message"; message : Collab.Message }
        | { op : "presence.join" | "presence.leave"; userId : string; status : Collab.PresenceStatus }
        | { op : "evict" }
        | { op : "error"; message : string };
}

export default CollabSocketService;
// eof
