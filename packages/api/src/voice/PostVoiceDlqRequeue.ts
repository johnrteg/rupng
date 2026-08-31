//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import { Voice } from "./model/Voice";

//
// Requeue dead-lettered messages (voice-5.0) — resends each item's EXACT original `body` back to its source
// queue, then deletes it from the `<queue>-dlq` companion. Body is the item list a prior `GetVoiceDlq` call
// returned (the operator selects which ones to retry) — never re-received server-side, so the receipt handles
// stay valid. APPLICATION.
//
export class PostVoiceDlqRequeue extends RestfulEndpoint< {}, PostVoiceDlqRequeue.Body, PostVoiceDlqRequeue.Response >
{
    public readonly uri      : string = PostVoiceDlqRequeue.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.POST;
    public readonly access   : Access.Role = Access.AppRole.APPLICATION;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "requeueVoiceDlq",
        summary:     "Requeue dead-lettered voice messages",
        description: "Resends the given DLQ items to their source queue and removes them from the dead-letter queue.",
        tags:        [ "Voice" ],
    };

    constructor( body? : PostVoiceDlqRequeue.Body ) { super( {}, body ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return []; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null
    {
        return {
            type: "object", additionalProperties: false, required: [ "items" ],
            properties: {
                items: { type: "array", items: {
                    type: "object", additionalProperties: false, required: [ "queue", "messageId", "receiptHandle", "body" ],
                    properties: {
                        queue:         { type: "string", enum: Object.values( Voice.DlqQueue ) },
                        messageId:     { type: "string" },
                        receiptHandle: { type: "string" },
                        body:          { type: "string" },
                        approxReceiveCount: { type: "number" },
                    },
                } },
            },
        };
    }
}

export namespace PostVoiceDlqRequeue
{
    export const URI : string = apiPath( "voice", 1, "/dlq/requeue" );
    export interface Body extends RestfulEndpoint.AuthRequest { items : Array<Voice.DlqItem>; }
    export interface Response { requeued : number; }
    export enum Error
    {
        BAD_REQUEST  = NetworkUtils.Status.BAD_REQUEST,
        UNAUTHORIZED = NetworkUtils.Status.UNAUTHORIZED,
        FORBIDDEN    = NetworkUtils.Status.FORBIDDEN,
    }
}

export default PostVoiceDlqRequeue;
// eof
