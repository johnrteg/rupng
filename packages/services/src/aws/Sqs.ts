//
// SQS facade — send/receive/delete messages, keyed by cloud-manifest LOGICAL queue keys.
//
import { SQSClient, SendMessageCommand, ReceiveMessageCommand, DeleteMessageCommand, GetQueueAttributesCommand } from "@aws-sdk/client-sqs";
import type { Message, QueueAttributeName, ReceiveMessageCommandOutput, GetQueueAttributesCommandOutput } from "@aws-sdk/client-sqs";
import type { CloudResolver, ResourceKey } from "@repo/cloud-manifest";
import { ResultUtils } from "@repo/common";
import type { Type } from "@repo/common";
import { ClientUtils } from "./ClientUtils";
import { RequestContext } from "../RequestContext";

/**
 * SQS facade — the routine message operations over `@aws-sdk/client-sqs`, addressed by
 * cloud-manifest LOGICAL queue keys (e.g. `"process"`).
 *
 * **Use SQS for** decoupled, durable point-to-point work queues (one consumer group draining
 * a backlog, with retries + a DLQ). For pub/sub fan-out use SNS/EventBridge; for high-volume
 * streaming/replay use Kafka. Reach through `.client` for batch send/receive or queue attrs.
 */
export class Sqs
{
    private _client? : SQSClient;

    ///////////////////////////////////////////////////////////////////////////////////////////
    /** @param cloud the owning service's resolver — maps logical queue keys to queue URLs. */
    constructor( private readonly cloud : CloudResolver ) {}

    ///////////////////////////////////////////////////////////////////////////////////////////
    /** The raw `SQSClient` — escape hatch (batch ops, visibility changes, queue attributes). Lazy + cached. */
    get client() : SQSClient { return this._client ??= ClientUtils.createClient( SQSClient ); }

    ///////////////////////////////////////////////////////////////////////////////////////////
    /** Resolve a cloud-manifest logical queue key (e.g. `"process"`) to its physical queue URL. */
    url( key : ResourceKey ) : string { return this.cloud.queueUrl( key ); }

    ///////////////////////////////////////////////////////////////////////////////////////////
    /**
     * Enqueue a message. Non-string bodies are JSON-stringified.
     *
     * For a **FIFO** queue pass `groupId` (ordering scope — messages with the same group are
     * delivered in order, one at a time) and optionally `dedupeId` (exactly-once within the
     * dedup window). `delaySeconds` defers visibility (standard queues only).
     *
     * @param queueKey logical queue key.
     * @param body     message payload (object → JSON).
     */
    send( queueKey : ResourceKey, body : string | object, opts : { delaySeconds? : number; groupId? : string; dedupeId? : string; transactionId? : string } = {} ) : Promise<Type.Result<void>>
    {
        return ResultUtils.from( async () : Promise<void> =>
        {
            // carry the transaction id as a MESSAGE ATTRIBUTE (out-of-band metadata — no message-body change),
            // so a queue-triggered consumer/job re-links to the request that enqueued it. Ambient by default.
            const transactionId : string | undefined = opts.transactionId ?? RequestContext.transactionId();

            await this.client.send( new SendMessageCommand( {
                QueueUrl               : this.url( queueKey ),
                MessageBody            : typeof body === "string" ? body : JSON.stringify( body ),
                DelaySeconds           : opts.delaySeconds,
                MessageGroupId         : opts.groupId,
                MessageDeduplicationId : opts.dedupeId,
                MessageAttributes      : transactionId
                    ? { transactionId: { DataType: "String", StringValue: transactionId } }
                    : undefined,
            } ) );
        } );
    }

    ///////////////////////////////////////////////////////////////////////////////////////////
    /**
     * Send to a queue by its EXPLICIT URL rather than a logical key — for a CROSS-SERVICE queue this service
     * doesn't own (e.g. auth dropping a send request on the email service's send queue). Carries the ambient
     * transaction id as a message attribute, same as {@link send}.
     * @param queueUrl the fully-qualified SQS queue URL.
     * @param body     message payload (object → JSON).
     */
    sendToUrl( queueUrl : string, body : string | object, opts : { delaySeconds? : number; groupId? : string; dedupeId? : string; transactionId? : string } = {} ) : Promise<Type.Result<void>>
    {
        return ResultUtils.from( async () : Promise<void> =>
        {
            // carry the transaction id out-of-band so the consuming service re-links to the enqueuing request
            const transactionId : string | undefined = opts.transactionId ?? RequestContext.transactionId();

            await this.client.send( new SendMessageCommand( {
                QueueUrl               : queueUrl,
                MessageBody            : typeof body === "string" ? body : JSON.stringify( body ),
                DelaySeconds           : opts.delaySeconds,
                MessageGroupId         : opts.groupId,
                MessageDeduplicationId : opts.dedupeId,
                MessageAttributes      : transactionId
                    ? { transactionId: { DataType: "String", StringValue: transactionId } }
                    : undefined,
            } ) );
        } );
    }

    ///////////////////////////////////////////////////////////////////////////////////////////
    /**
     * Long-poll for up to `max` messages. Each returned message MUST be {@link delete}d after
     * successful processing, or it reappears after the visibility timeout (the retry mechanism).
     * @param max         max messages to fetch (1–10, default 10).
     * @param waitSeconds long-poll wait (0–20, default 20 — fewer empty receives, lower cost).
     */
    receive( queueKey : ResourceKey, max : number = 10, waitSeconds : number = 20 ) : Promise<Type.Result<Array<Message>>>
    {
        return ResultUtils.from( async () : Promise<Array<Message>> =>
        {
            const result : ReceiveMessageCommandOutput = await this.client.send( new ReceiveMessageCommand( {
                QueueUrl              : this.url( queueKey ),
                MaxNumberOfMessages   : max,
                WaitTimeSeconds       : waitSeconds,
                MessageAttributeNames : [ "All" ],   // return our `transactionId` attribute (see send/transactionId)
                // ApproximateReceiveCount lets a consumer tell "this is my last shot before the DLQ" (compare
                // against the queue's own maxReceiveCount) and fail a durable row explicitly instead of letting
                // it silently dead-letter with no record of why.
                MessageSystemAttributeNames : [ "ApproximateReceiveCount" ],
            } ) );
            return result.Messages ?? [];
        } );
    }

    ///////////////////////////////////////////////////////////////////////////////////////////
    /**
     * Read queue attributes by its EXPLICIT URL rather than a logical key — the escape hatch for
     * inspecting a queue this service doesn't own (e.g. `monitor` reading depth/age for a
     * dashboard widget). Common names: `ApproximateNumberOfMessages`,
     * `ApproximateNumberOfMessagesNotVisible` (age-of-oldest-message is a CloudWatch metric, not a
     * queue attribute — not available here).
     */
    attributesByUrl( queueUrl : string, names : Array<QueueAttributeName> ) : Promise<Type.Result<Partial<Record<QueueAttributeName, string>>>>
    {
        return ResultUtils.from( async () : Promise<Partial<Record<QueueAttributeName, string>>> =>
        {
            const result : GetQueueAttributesCommandOutput = await this.client.send( new GetQueueAttributesCommand( {
                QueueUrl: queueUrl,
                AttributeNames: names,
            } ) );
            return ( result.Attributes ?? {} ) as Partial<Record<QueueAttributeName, string>>;
        } );
    }

    ///////////////////////////////////////////////////////////////////////////////////////////
    /** Acknowledge (delete) a processed message by its receipt handle, so it isn't redelivered. */
    delete( queueKey : ResourceKey, receiptHandle : string ) : Promise<Type.Result<void>>
    {
        return ResultUtils.from( async () : Promise<void> =>
        {
            await this.client.send( new DeleteMessageCommand( { QueueUrl: this.url( queueKey ), ReceiptHandle: receiptHandle } ) );
        } );
    }

    ///////////////////////////////////////////////////////////////////////////////////////////
    /** The transaction id an enqueuer stamped (message attribute), if any. A consumer wraps its processing in
     *  `RequestContext.run({ transactionId: Sqs.transactionId(msg) }, …)` so its logs + downstream work re-link
     *  to the originating request. */
    public static transactionId( message : Message ) : string | undefined
    {
        return message.MessageAttributes?.transactionId?.StringValue;
    }
}
