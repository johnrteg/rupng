//
// Lambda facade — invoke other functions, keyed by cloud-spec LOGICAL function keys.
//
import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";
import type { InvokeCommandOutput } from "@aws-sdk/client-lambda";
import type { CloudResolver, ResourceKey } from "@repo/cloud-spec";
import { ClientUtils } from "./ClientUtils";

/**
 * Lambda facade — invoke functions over `@aws-sdk/client-lambda`, addressed by cloud-spec
 * LOGICAL function keys (e.g. `"processor"`).
 *
 * **Use for** service-to-service calls to a function you own. Prefer {@link invoke}
 * (request/response) only when you need the result *now*; for fire-and-forget work prefer
 * {@link fire} (async) — or, better, a queue/event ({@link Sqs}/{@link EventBridge}) for
 * durability + retries. Reach through `.client` for aliases, versions, or streaming responses.
 */
export class Lambda
{
    private _client? : LambdaClient;

    /** @param cloud the owning service's resolver — maps logical function keys to function ARNs. */
    constructor( private readonly cloud : CloudResolver ) {}

    /** The raw `LambdaClient` — escape hatch (aliases, async config, streaming). Lazy + cached. */
    get client() : LambdaClient { return this._client ??= ClientUtils.createClient( LambdaClient ); }

    /** Resolve a cloud-spec logical function key (e.g. `"processor"`) to its physical ARN. */
    fn( key : ResourceKey ) : string { return this.cloud.functionArn( key ); }

    /**
     * Invoke **synchronously** (request/response) and return the parsed JSON result. Blocks until
     * the target finishes — use only when you need its output; otherwise prefer {@link fire}.
     * @typeParam T the expected JSON result shape.
     */
    async invoke<T>( fnKey : ResourceKey, payload : unknown ) : Promise<T | undefined>
    {
        const result : InvokeCommandOutput = await this.client.send( new InvokeCommand( {
            FunctionName   : this.fn( fnKey ),
            InvocationType : "RequestResponse",
            Payload        : new TextEncoder().encode( JSON.stringify( payload ) ),
        } ) );
        return result.Payload ? ( JSON.parse( new TextDecoder().decode( result.Payload ) ) as T ) : undefined;
    }

    /**
     * Invoke **asynchronously** (event) — returns as soon as the event is accepted; the result
     * is discarded and failures route to the function's own async dead-letter/destination.
     */
    async fire( fnKey : ResourceKey, payload : unknown ) : Promise<void>
    {
        await this.client.send( new InvokeCommand( {
            FunctionName   : this.fn( fnKey ),
            InvocationType : "Event",
            Payload        : new TextEncoder().encode( JSON.stringify( payload ) ),
        } ) );
    }
}
