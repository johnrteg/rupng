//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import { Print } from "./model/Print";

//
// Requeue dead-lettered messages (print-9) — resends each item's EXACT original `body` back to its source
// queue, then deletes it from the `<queue>-dlq` companion. APPLICATION.
//
export class PostPrintDlqRequeue extends RestfulEndpoint< {}, PostPrintDlqRequeue.Body, PostPrintDlqRequeue.Response >
{
    public readonly uri      : string = PostPrintDlqRequeue.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.POST;
    public readonly access   : Access.Role = Access.AppRole.APPLICATION;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "requeuePrintDlq",
        summary:     "Requeue dead-lettered print messages",
        description: "Resends the given DLQ items to their source queue and removes them from the dead-letter queue.",
        tags:        [ "Print" ],
    };

    constructor( body? : PostPrintDlqRequeue.Body ) { super( {}, body ); }
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
                        queue:         { type: "string", enum: Object.values( Print.DlqQueue ) },
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

export namespace PostPrintDlqRequeue
{
    export const URI : string = apiPath( "print", 1, "/dlq/requeue" );
    export interface Body extends RestfulEndpoint.AuthRequest { items : Array<Print.DlqItem>; }
    export interface Response { requeued : number; }
    export enum Error
    {
        BAD_REQUEST  = NetworkUtils.Status.BAD_REQUEST,
        UNAUTHORIZED = NetworkUtils.Status.UNAUTHORIZED,
        FORBIDDEN    = NetworkUtils.Status.FORBIDDEN,
    }
}

export default PostPrintDlqRequeue;
// eof
