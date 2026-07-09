//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import { Email } from "./model/Email";

//
// Enqueue an email SEND (email-1.1/1.3). PUBLIC — reachable from the public API (dev-key, SENDER role) as well as
// first-party/S2S callers (campaign / workflow / transactional); returns 202 with a job pointer. Body is an
// Email.SendRequest: recipients may be literal addresses OR contact UUIDs (resolved + merged at send), and the
// body is either inline `html`/`text` OR a `templateId` + `mergeData`. canSend() + suppression + idempotency +
// contact resolution + placeholder merge are applied by the send worker, not here. Body validated loosely.
//
export class PostEmailSend extends RestfulEndpoint< {}, PostEmailSend.Body, PostEmailSend.Response >
{
    public readonly uri      : string = PostEmailSend.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.POST;
    public readonly access   : Access.Role = Access.AccountRole.SENDER;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.PUBLIC;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "sendEmail",
        summary:     "Enqueue an email send",
        description: "Enqueues a single email send. Recipients may be literal addresses or contact UUIDs; the body is an inline html/text message or a template + merge data. Returns 202; the worker resolves recipients, renders, gates (canSend), and delivers.",
        tags:        [ "Email" ],
    };

    constructor( body? : PostEmailSend.Body ) { super( {}, body ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return []; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null
    {
        // loose — the send worker resolves recipients / template / merge and does full validation
        return {
            type: "object", additionalProperties: true, required: [ "to" ],
            properties: {
                to:               { type: "array" },
                templateId:       { type: "string" },
                notificationType: { type: "string", enum: Object.values( Email.NotificationType ) },
                subject:          { type: "string" },
                campaignId:       { type: "string" },
                provider:         { type: "string", enum: Object.values( Email.Provider ) },
            },
        };
    }

    // success body — the 202 enqueue ack
    public getResponseSchema(): RestfulEndpoint.Schema | null
    {
        return {
            type: "object", required: [ "queued" ],
            properties: {
                queued: { type: "boolean", description: "Whether the send was accepted + enqueued." },
                jobId:  { type: "string",  description: "The enqueued job id (for correlation)." },
            },
        };
    }
}

export namespace PostEmailSend
{
    export const URI : string = apiPath( "email", 1, "/send" );
    export interface Body extends RestfulEndpoint.AuthRequest, Email.SendRequest {}
    export interface Response { queued : boolean; jobId? : string; }
    export enum Error
    {
        BAD_REQUEST  = NetworkUtils.Status.BAD_REQUEST,
        UNAUTHORIZED = NetworkUtils.Status.UNAUTHORIZED,
    }
}

export default PostEmailSend;
// eof
