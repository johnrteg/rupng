//
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocketServer, WebSocket } from "ws";

import { Application, Service, Register, Kafka, Ports } from "@repo/services";
import { Events } from "@repo/system";

//
// RealtimeService — PHASE 1 of the Kafka -> browser push bridge (see ../../SPECS.md). Consumes the WHOLE
// Kafka entity-event vocabulary (no curated push-set filter yet) and forwards each envelope, unmodified and
// with NO per-type branching, to every open browser connection scoped to that envelope's `accountId`.
//
// This phase is a deliberate simplification of SPECS.md's target design: connections are held IN-PROCESS
// (a `Map<accountId, Set<WebSocket>>`), not in a DynamoDB registry, and the browser's WebSocket upgrade is
// terminated DIRECTLY on this container (dev-only path, bridged locally by the webproxy) rather than via a
// real API Gateway WebSocket API + Lambda `$connect`/`$disconnect`. That means this phase only works with a
// single running instance — multi-instance fan-out (the real registry + `WebSocketApi.post`) is a later
// phase, once this needs to scale past one process.
//
export class RealtimeService extends Service
{
    // open browser connections, keyed by the `accountId` they were opened with — the ENTIRE authorization
    // model for phase 1: an envelope only reaches the sockets registered under its own `accountId`
    private readonly connectionsByAccount : Map<string, Set<WebSocket>> = new Map<string, Set<WebSocket>>();

    private _kafka? : Kafka;
    private wss?    : WebSocketServer;

    ////////////////////////////////////////////////////////////////////////////////////////////
    constructor()
    {
        super( Register.Service.REALTIME, RealtimeService.Role.MAIN, Ports.REALTIME.MAIN );
        const pkg : Application.PackageInfo = this.loadPackageInfo( __dirname );
        this.setVersion( pkg.version );
        this.log.info( "version", { name: pkg.name, version: pkg.version } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** Kafka facade — subscribes to the entity-event firehose. Lazy + cached. */
    public get kafka() : Kafka { return this._kafka ??= new Kafka( this.cloud ); }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** Register the health/version routes (inherited), then attach the dev WebSocket bridge and start the
     *  broadcast consumer. Both are best-effort — a Kafka outage or bridge failure must not stop boot. */
    protected override async registerEndpoints() : Promise<void>
    {
        await super.registerEndpoints();       // keeps /health + /version

        this.attachWebSocketBridge();
        void this.startBroadcastConsumer();
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // Hook the underlying Node HTTP server's `upgrade` event so a raw WebSocket client (the web app's
    // `WebsocketService`, proxied locally by webproxy) can connect directly to this container. PHASE-1 ONLY —
    // production instead terminates the socket at a real API Gateway WebSocket API (see SPECS.md).
    private attachWebSocketBridge() : void
    {
        const httpServer = this.server?.server;
        if( httpServer === undefined )
        {
            this.log.warn( "realtime: no underlying HTTP server yet — WebSocket bridge not attached" );
            return;
        }

        this.wss = new WebSocketServer( { noServer: true } );
        httpServer.on( "upgrade", ( request : IncomingMessage, socket : Duplex, head : Buffer ) : void => this.handleUpgrade( request, socket, head ) );
        this.log.info( "realtime: WebSocket bridge attached" );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // Accept (or reject) one upgrade request. The client connects as `/account/ws?cid=<accountId>` — the
    // SAME contract the web app's `WebsocketService` already speaks. A missing `cid` is refused outright:
    // there is no anonymous/unscoped connection.
    private handleUpgrade( request : IncomingMessage, socket : Duplex, head : Buffer ) : void
    {
        const url : URL = new URL( request.url ?? "", "http://localhost" );
        const accountId : string = url.searchParams.get( "cid" ) ?? "";
        if( accountId === "" )
        {
            socket.destroy();
            return;
        }

        this.wss?.handleUpgrade( request, socket, head, ( ws : WebSocket ) : void => this.onConnectionOpened( ws, accountId ) );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // Register a newly-opened connection under its account, and prune it on close/error.
    private onConnectionOpened( ws : WebSocket, accountId : string ) : void
    {
        this.addConnection( accountId, ws );
        this.log.info( "realtime: connection opened", { accountId, connections: this.connectionsByAccount.get( accountId )?.size ?? 0 } );

        ws.on( "close", () : void => this.onConnectionClosed( accountId, ws ) );
        ws.on( "error", () : void => this.onConnectionClosed( accountId, ws ) );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // Drop a connection from the registry — the reverse of onConnectionOpened. Idempotent (safe to call
    // from both `close` and `error`).
    private onConnectionClosed( accountId : string, ws : WebSocket ) : void
    {
        this.removeConnection( accountId, ws );
        this.log.info( "realtime: connection closed", { accountId, connections: this.connectionsByAccount.get( accountId )?.size ?? 0 } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** Add a connection to its account's set (creating the set on first connection). */
    private addConnection( accountId : string, ws : WebSocket ) : void
    {
        const existing : Set<WebSocket> | undefined = this.connectionsByAccount.get( accountId );
        const sockets : Set<WebSocket> = existing ?? new Set<WebSocket>();
        sockets.add( ws );
        if( existing === undefined ) this.connectionsByAccount.set( accountId, sockets );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** Remove a connection from its account's set, and drop the set entirely once it's empty. */
    private removeConnection( accountId : string, ws : WebSocket ) : void
    {
        const sockets : Set<WebSocket> | undefined = this.connectionsByAccount.get( accountId );
        if( sockets === undefined ) return;
        sockets.delete( ws );
        if( sockets.size === 0 ) this.connectionsByAccount.delete( accountId );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // Subscribe to EVERY Events.Object topic (the whole firehose — no push-set filter in phase 1) and
    // broadcast each envelope as it arrives. Best-effort: no Kafka brokers configured (local dev with no
    // bus) or a bus outage must never block boot.
    private async startBroadcastConsumer() : Promise<void>
    {
        if( !this.kafka.configured() )
        {
            this.log.info( "realtime broadcast consumer skipped — no Kafka brokers configured (dev)" );
            return;
        }

        try
        {
            const objects : Array<Events.Object> = Object.values( Events.Object );
            await this.kafka.subscribeEvents( "realtime-broadcast", objects, async ( event : Events.Envelope ) : Promise<void> =>
            {
                this.broadcast( event );
            } );
            this.log.info( "realtime broadcast consumer subscribed", { topics: objects.length } );
        }
        catch( error )
        {
            this.log.warn( "realtime broadcast consumer failed to start (bus unreachable?)", { error: String( error ) } );
        }
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // Forward ONE envelope, verbatim, to every connection scoped to its accountId. Deliberately does NOT
    // branch on `event.object`/`event.verb` — that's the platform instruction for this phase: pipe the
    // event through, don't act on its type. A missing accountId is dropped + logged (fail closed — there is
    // no connection set to deliver an unscoped event to anyway).
    private broadcast( event : Events.Envelope ) : void
    {
        if( !event.accountId )
        {
            this.log.warn( "realtime: dropping event with no accountId", { action: event.action } );
            return;
        }

        const sockets : Set<WebSocket> | undefined = this.connectionsByAccount.get( event.accountId );
        if( sockets === undefined || sockets.size === 0 ) return;

        const frame : string = JSON.stringify( event );
        sockets.forEach( ( ws : WebSocket ) : void => this.sendIfOpen( ws, frame ) );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** Send `frame` to `ws` only if the connection is still open (it may have closed between the registry
     *  lookup and the send). */
    private sendIfOpen( ws : WebSocket, frame : string ) : void
    {
        if( ws.readyState === WebSocket.OPEN ) ws.send( frame );
    }
}

export namespace RealtimeService
{
    export enum Role { MAIN = "main" }
    export const PORT : Record<Role, number> = { [ Role.MAIN ]: Ports.REALTIME.MAIN };
}

export default RealtimeService;
// eof
