//
// WebSocket facade — push to connected clients via the API Gateway Management API, keyed by a
// cloud-spec LOGICAL websocket key.
//
import { ApiGatewayManagementApiClient, PostToConnectionCommand, DeleteConnectionCommand } from "@aws-sdk/client-apigatewaymanagementapi";
import type { CloudResolver, ResourceKey } from "@repo/cloud-spec";
import { ClientUtils } from "./ClientUtils";

/**
 * WebSocket facade — **server → client** push over the API Gateway Management API
 * (`@aws-sdk/client-apigatewaymanagementapi`), against the management endpoint resolved from a
 * cloud-spec LOGICAL websocket key (default `"live"`).
 *
 * Connections are identified by the `connectionId` API Gateway supplies on `$connect` (store
 * it, keyed by user/session, so you can {@link post} to it later). Use for live inboxes,
 * real-time updates, presence. Reach through `.client` for anything else.
 */
export class WebSocketApi
{
    private _client? : ApiGatewayManagementApiClient;

    /**
     * @param cloud the owning service's resolver — maps the logical websocket key to its URL.
     * @param wsKey logical websocket key (default `"live"`).
     */
    constructor( private readonly cloud : CloudResolver, private readonly wsKey : ResourceKey = "live" ) {}

    /**
     * The `ApiGatewayManagementApiClient`, pointed at the API's callback (management) endpoint —
     * the WebSocket URL as `https`. Lazy + cached.
     */
    get client() : ApiGatewayManagementApiClient
    {
        if( this._client === undefined )
        {
            const endpoint : string = this.cloud.webSocketUrl( this.wsKey ).replace( /^wss:/, "https:" );
            this._client = ClientUtils.createClient( ApiGatewayManagementApiClient, { endpoint } );
        }
        return this._client;
    }

    /**
     * Push a message to a single connected client. Non-string data is JSON-stringified.
     *
     * If the client has since disconnected, the API throws `GoneException` (410) — catch it and
     * drop your stored `connectionId`.
     * @param connectionId the id from the `$connect` event.
     * @param data         payload (object → JSON).
     */
    async post( connectionId : string, data : string | object ) : Promise<void>
    {
        await this.client.send( new PostToConnectionCommand( {
            ConnectionId : connectionId,
            Data         : typeof data === "string" ? data : JSON.stringify( data ),
        } ) );
    }

    /** Force-close a connection from the server side. */
    async disconnect( connectionId : string ) : Promise<void>
    {
        await this.client.send( new DeleteConnectionCommand( { ConnectionId: connectionId } ) );
    }
}
