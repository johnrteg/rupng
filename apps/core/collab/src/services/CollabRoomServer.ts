//
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocketServer, WebSocket } from "ws";
import { CognitoJwtVerifier } from "aws-jwt-verify";

import { Authorizer, Cache } from "@repo/services";
import { Collab } from "@repo/api";
import type { Type } from "@repo/common";

import CollabService from "./CollabService";

//
// CollabRoomServer — the STATEFUL WebSocket room server (collab-1.1/5.1/5.2). Mirrors `apps/core/realtime`'s
// `noServer`+`upgrade` raw-`ws` termination pattern, but: (1) verifies the caller + room membership at
// connect (realtime's dev bridge only checks a bare `cid`), (2) is room-scoped, not account-scoped, and
// (3) sits behind a REAL public, sticky-session ALB (see CloudManifest.ts) — not a dev-only local bridge.
//
// JWT verification: every OTHER service gets Cognito signature verification for free from the API Gateway JWT
// authorizer sitting in front of it; this service has NO Gateway in front (reached directly via the public
// ALB), so it verifies the JWT itself here, via `aws-jwt-verify`'s `CognitoJwtVerifier` (real signature check
// against the pool's JWKS — cached in-memory after the first fetch — plus issuer + expiry). The pool id
// arrives as `USERPOOL_USERS` (see CloudManifest.ts's `uses: [{ kind: USER_POOL }]` — CDK-injected from
// auth's provisioned pool, no IAM grant needed since JWKS is public HTTPS). Simplification: `tokenUse` and
// `clientId` are NOT asserted (passed `null`) — the web app's session token's exact Cognito token type/client
// isn't threaded through to this service yet; signature + issuer + expiry are still fully verified regardless.
//
export class CollabRoomServer extends CollabService
{
    // LOCAL (this instance only) connections, keyed by room. Cross-instance fan-out rides Redis pub/sub —
    // see subscribeRoom/publishRoomEvent.
    private readonly socketsByRoom : Map<string, Set<CollabRoomServer.Connection>> = new Map();
    // rooms this instance currently subscribes to on Redis (avoid double-subscribing the same channel)
    private readonly subscribedRooms : Set<string> = new Set();
    // a SEPARATE Redis connection for subscribe mode (ioredis can't share one connection between
    // pub/other-commands and subscribe mode) — a distinct `Cache` instance, own lazy `.client` connection.
    private readonly subscriber : Cache;
    private wss? : WebSocketServer;
    // lazy — constructing a CognitoJwtVerifier eagerly would throw at boot if USERPOOL_USERS isn't set yet
    // (e.g. a partial local-dev deploy); built on first use instead, so a missing pool id fails CLOSED
    // (every connection refused + logged) rather than crashing the whole process.
    private _jwtVerifier? : ReturnType<typeof CollabRoomServer.buildVerifier>;

    ////////////////////////////////////////////////////////////////////////////////////////////
    constructor()
    {
        super( CollabService.Role.ROOM );
        this.subscriber = new Cache( this.cloud, "cache" );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    protected override async registerEndpoints() : Promise<void>
    {
        await super.registerEndpoints();       // keeps /health + /version
        this.attachRoomSocketBridge();
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // Hook the underlying Node HTTP server's `upgrade` event — same shape as RealtimeService's dev bridge,
    // but this is the REAL, production connect path (behind the public sticky ALB), not a dev-only shortcut.
    private attachRoomSocketBridge() : void
    {
        const httpServer = this.server?.server;
        if( httpServer === undefined )
        {
            this.log.warn( "collab room server: no underlying HTTP server yet — WebSocket bridge not attached" );
            return;
        }

        this.wss = new WebSocketServer( { noServer: true } );
        httpServer.on( "upgrade", ( request : IncomingMessage, socket : Duplex, head : Buffer ) : void => { void this.handleUpgrade( request, socket, head ); } );
        this.log.info( "collab room server: WebSocket bridge attached" );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // Accept (or reject) one upgrade request — `/collab/rooms/:roomId/ws?token=<jwt>&account=<accountId>`. A
    // native browser WebSocket can't send custom headers, so both the (now REALLY verified — see verifyUserId)
    // JWT and the acting account travel as query params, mirroring realtime's `?cid=` convention. NOTE: this
    // still means the bearer token sits in the URL, which an ALB access log captures verbatim — a separate,
    // still-open hardening item (short-lived single-use "connect tickets" instead of the raw JWT).
    private async handleUpgrade( request : IncomingMessage, socket : Duplex, head : Buffer ) : Promise<void>
    {
        const url : URL = new URL( request.url ?? "", "http://localhost" );
        const match : RegExpMatchArray | null = url.pathname.match( /^\/collab\/rooms\/([^/]+)\/ws$/ );
        const roomId : string = match?.[ 1 ] ?? "";
        const token : string = url.searchParams.get( "token" ) ?? "";
        const accountId : string = url.searchParams.get( "account" ) ?? "";
        const userId : string | undefined = await this.verifyUserId( token );

        if( roomId === "" || accountId === "" || userId === undefined ) { socket.destroy(); return; }

        const admitted : boolean = await this.canJoin( accountId, roomId, userId );
        if( !admitted ) { socket.destroy(); return; }

        this.wss?.handleUpgrade( request, socket, head, ( ws : WebSocket ) : void => { void this.onConnectionOpened( ws, accountId, roomId, userId ); } );
    }

    // build the verifier for auth's pool — a plain function (not a field initializer) so its return type can
    // be captured via `ReturnType<typeof ...>` for the lazy `_jwtVerifier` field's type, without having to
    // spell out `aws-jwt-verify`'s generic verifier type by hand.
    private static buildVerifier( userPoolId : string )
    {
        return CognitoJwtVerifier.create( { userPoolId, tokenUse: null, clientId: null } );
    }

    private jwtVerifier() : ReturnType<typeof CollabRoomServer.buildVerifier> | undefined
    {
        if( this._jwtVerifier !== undefined ) return this._jwtVerifier;
        const userPoolId : string = process.env.USERPOOL_USERS ?? "";
        if( userPoolId === "" )
        {
            this.log.error( "collab room server: USERPOOL_USERS is not set — refusing every connection (fail closed)" );
            return undefined;
        }
        this._jwtVerifier = CollabRoomServer.buildVerifier( userPoolId );
        return this._jwtVerifier;
    }

    // REAL signature verification (JWKS, cached after first fetch) + issuer + expiry — see the class doc for
    // what's still simplified (tokenUse/clientId unchecked). Any failure — expired, bad signature, wrong
    // issuer, unreachable JWKS, no pool configured — returns undefined (fail closed), logged for visibility.
    private async verifyUserId( token : string ) : Promise<string | undefined>
    {
        const verifier = this.jwtVerifier();
        if( verifier === undefined || token === "" ) return undefined;
        try
        {
            const payload = await verifier.verify( token );
            return payload.sub;
        }
        catch( error )
        {
            this.log.warn( "collab: JWT verification failed — refusing connection", { error: String( error ) } );
            return undefined;
        }
    }

    // room-join admission (collab-7.1/7.2/7.4): the room must exist; a PRIVATE room requires explicit
    // membership; a PUBLIC room admits any user who's a member of the OWNING account at all (checked via the
    // shared Authorizer read — the sanctioned cross-service authz path, never a direct read of account's table).
    private async canJoin( accountId : string, roomId : string, userId : string ) : Promise<boolean>
    {
        const room : Type.Result<Collab.Room | undefined> = await this.getRoom( accountId, roomId );
        if( !room.ok || room.data === undefined || room.data.archived ) return false;

        if( room.data.visibility === Collab.Visibility.PRIVATE )
        {
            const member : Type.Result<{ roomId : string; userId : string } | undefined> = await this.isMember( roomId, userId );
            return member.ok && member.data !== undefined;
        }

        const authorizer : Authorizer = new Authorizer( this.cloud );
        const role : Awaited<ReturnType<Authorizer[ "roleFor" ]>> = await authorizer.roleFor( userId, accountId );
        return role !== undefined;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    private async onConnectionOpened( ws : WebSocket, accountId : string, roomId : string, userId : string ) : Promise<void>
    {
        const connection : CollabRoomServer.Connection = { ws, accountId, roomId, userId };
        this.addLocalConnection( roomId, connection );
        await this.subscribeRoom( roomId );
        await this.presenceConnected( accountId, userId );
        this.log.info( "collab: connection opened", { accountId, roomId, userId } );

        ws.on( "message", ( raw : Buffer ) : void => { void this.onFrame( connection, raw ); } );
        ws.on( "close", () : void => { void this.onConnectionClosed( connection ); } );
        ws.on( "error", () : void => { void this.onConnectionClosed( connection ); } );
    }

    private async onConnectionClosed( connection : CollabRoomServer.Connection ) : Promise<void>
    {
        this.removeLocalConnection( connection.roomId, connection );
        await this.presenceDisconnected( connection.accountId, connection.userId );
        if( ( this.socketsByRoom.get( connection.roomId )?.size ?? 0 ) === 0 ) await this.unsubscribeRoom( connection.roomId );
        this.log.info( "collab: connection closed", { accountId: connection.accountId, roomId: connection.roomId, userId: connection.userId } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // one JSON frame from a client — collab-3.2/4.1 (`chat.send` / `presence.status` / `ping`; no binary
    // Y.js frames in v1 — see CloudManifest.ts's scope note).
    private async onFrame( connection : CollabRoomServer.Connection, raw : Buffer ) : Promise<void>
    {
        let frame : CollabRoomServer.ClientFrame;
        try { frame = JSON.parse( raw.toString( "utf8" ) ); }
        catch { this.sendError( connection.ws, "malformed frame" ); return; }

        if( frame.op === "ping" ) { this.send( connection.ws, { op: "pong" } ); return; }

        if( frame.op === "chat.send" )
        {
            if( typeof frame.text !== "string" || frame.text.trim() === "" ) { this.sendError( connection.ws, "text is required" ); return; }
            const posted : Type.Result<Collab.Message> = await this.postMessage( connection.roomId, connection.userId, frame.text );
            if( posted.ok ) await this.publishRoomEvent( connection.roomId, { kind: "chat.message", message: posted.data } );
            return;
        }

        if( frame.op === "presence.status" )
        {
            if( frame.status !== Collab.PresenceStatus.ACTIVE && frame.status !== Collab.PresenceStatus.IDLE ) { this.sendError( connection.ws, "invalid status" ); return; }
            await this.presenceSetStatus( connection.accountId, connection.userId, frame.status );
            await this.publishRoomEvent( connection.roomId, { kind: "presence", userId: connection.userId, status: frame.status } );
            return;
        }

        this.sendError( connection.ws, "unknown op" );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // ── Cross-node fan-out (Redis pub/sub — collab-4.3/5.3) ───────────────────────────────────────

    private async subscribeRoom( roomId : string ) : Promise<void>
    {
        if( this.subscribedRooms.has( roomId ) ) return;
        this.subscribedRooms.add( roomId );
        await this.subscriber.client.subscribe( this.roomChannel( roomId ) );
        this.subscriber.client.on( "message", ( channel : string, message : string ) : void => this.onRoomEvent( roomId, channel, message ) );
    }

    private async unsubscribeRoom( roomId : string ) : Promise<void>
    {
        if( !this.subscribedRooms.has( roomId ) ) return;
        this.subscribedRooms.delete( roomId );
        await this.subscriber.client.unsubscribe( this.roomChannel( roomId ) );
    }

    // a published RoomEvent arrived — re-broadcast to every LOCAL socket for that room (an `evict` only to
    // the named user's own sockets, which it also closes).
    private onRoomEvent( expectedRoomId : string, channel : string, raw : string ) : void
    {
        if( channel !== this.roomChannel( expectedRoomId ) ) return;
        let event : CollabService.RoomEvent;
        try { event = JSON.parse( raw ); } catch { return; }

        const connections : Set<CollabRoomServer.Connection> = this.socketsByRoom.get( expectedRoomId ) ?? new Set();
        for( const connection of connections )
        {
            if( event.kind === "chat.message" ) this.send( connection.ws, { op: "chat.message", message: event.message } );
            else if( event.kind === "presence" ) this.send( connection.ws, { op: event.status === Collab.PresenceStatus.OFFLINE ? "presence.leave" : "presence.join", userId: event.userId, status: event.status } );
            else if( event.kind === "evict" && connection.userId === event.userId )
            {
                this.send( connection.ws, { op: "evict" } );
                connection.ws.close();
            }
        }
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    private addLocalConnection( roomId : string, connection : CollabRoomServer.Connection ) : void
    {
        const existing : Set<CollabRoomServer.Connection> | undefined = this.socketsByRoom.get( roomId );
        const set : Set<CollabRoomServer.Connection> = existing ?? new Set();
        set.add( connection );
        if( existing === undefined ) this.socketsByRoom.set( roomId, set );
    }

    private removeLocalConnection( roomId : string, connection : CollabRoomServer.Connection ) : void
    {
        const set : Set<CollabRoomServer.Connection> | undefined = this.socketsByRoom.get( roomId );
        if( set === undefined ) return;
        set.delete( connection );
        if( set.size === 0 ) this.socketsByRoom.delete( roomId );
    }

    private send( ws : WebSocket, frame : CollabRoomServer.ServerFrame ) : void
    {
        if( ws.readyState === WebSocket.OPEN ) ws.send( JSON.stringify( frame ) );
    }

    private sendError( ws : WebSocket, message : string ) : void
    {
        this.send( ws, { op: "error", message } );
    }
}

export namespace CollabRoomServer
{
    export interface Connection { ws : WebSocket; accountId : string; roomId : string; userId : string; }

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

export default CollabRoomServer;
// eof
