//
// SNS facade — publish notifications, keyed by cloud-manifest LOGICAL SNS topic keys.
//
import { SNSClient, PublishCommand } from "@aws-sdk/client-sns";
import type { CloudResolver, ResourceKey } from "@repo/cloud-manifest";
import { ResultUtils } from "@repo/common";
import type { Type } from "@repo/common";
import { ClientUtils } from "./ClientUtils";

/**
 * SNS facade — publish over `@aws-sdk/client-sns`, addressed by cloud-manifest LOGICAL topic keys
 * (e.g. `"alerts"`).
 *
 * **Use SNS for** fan-out notifications — one publish delivered to many subscribers
 * (email/SMS, Lambda, SQS), e.g. alarms or "something happened" alerts. For routed,
 * rule-matched domain events prefer {@link EventBridge}; for a durable work queue use
 * {@link Sqs}. Reach through `.client` for subscription management or message attributes.
 */
export class Sns
{
    private _client? : SNSClient;

    ///////////////////////////////////////////////////////////////////////////////////////////
    /** @param cloud the owning service's resolver — maps logical SNS topic keys to topic ARNs. */
    constructor( private readonly cloud : CloudResolver ) {}

    ///////////////////////////////////////////////////////////////////////////////////////////
    /** The raw `SNSClient` — escape hatch (subscribe, attributes, SMS). Lazy + cached. */
    get client() : SNSClient { return this._client ??= ClientUtils.createClient( SNSClient ); }

    ///////////////////////////////////////////////////////////////////////////////////////////
    /** Resolve a cloud-manifest logical SNS topic key (e.g. `"alerts"`) to its physical topic ARN.
     *  Internal — {@link publish} resolves the ARN for you; callers pass the logical key. (For raw
     *  `.client` work that needs an ARN, use `cloud.snsTopicArn(key)` directly.) */
    private arn( key : ResourceKey ) : string { return this.cloud.snsTopicArn( key ); }

    ///////////////////////////////////////////////////////////////////////////////////////////
    /**
     * Publish a message to all of the topic's subscribers. Non-string messages are
     * JSON-stringified. For a **FIFO** topic pass `groupId` (ordering scope) and `dedupeId`.
     * @param topicKey logical SNS topic key.
     * @param message  payload (object → JSON).
     * @param opts     `subject` (email subject line) / FIFO `groupId` + `dedupeId`.
     */
    publish( topicKey : ResourceKey, message : string | object, opts : { subject? : string; groupId? : string; dedupeId? : string } = {} ) : Promise<Type.Result<void>>
    {
        return ResultUtils.from( async () : Promise<void> =>
        {
            await this.client.send( new PublishCommand( {
                TopicArn               : this.arn( topicKey ),
                Message                : typeof message === "string" ? message : JSON.stringify( message ),
                Subject                : opts.subject,
                MessageGroupId         : opts.groupId,
                MessageDeduplicationId : opts.dedupeId,
            } ) );
        } );
    }
}
