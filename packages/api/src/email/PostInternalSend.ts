//
import { RestfulEndpoint, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";

//
// S2S: enqueue a simple email send (report-completion notifications, and similar S2S notices) — no acting
// user/X-Account on an S2S call, so the caller passes `accountId` explicitly. A thin INTERNAL-audience
// entrypoint into the EXISTING send pipeline (EmailService.enqueueSend, the same worker PostEmailSend uses) —
// not a new send mechanism. Plain to/subject/body only; templated/merged sends still go through PostEmailSend.
//
export class PostInternalSend extends RestfulEndpoint< {}, PostInternalSend.Body, PostInternalSend.Response >
{
    public readonly uri      : string = PostInternalSend.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.POST;
    public readonly access   : undefined = undefined;   // S2S (INTERNAL audience) — no RBAC role
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.INTERNAL;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "sendInternalEmail",
        summary:     "Enqueue a simple email send (S2S)",
        description: "Enqueues a single plain-body email send for the given account. Returns 202; the existing send worker renders, gates (canSend), and delivers.",
        tags:        [ "Email" ],
    };

    constructor( body? : PostInternalSend.Body ) { super( {}, body ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return []; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null
    {
        return {
            type: "object", additionalProperties: false, required: [ "accountId", "to", "subject", "body" ],
            properties: {
                accountId: { type: "string" },
                to:        { type: "string" },
                subject:   { type: "string" },
                body:      { type: "string", description: "plain text or html body" },
            },
        };
    }
}

export namespace PostInternalSend
{
    export const URI : string = apiPath( "email", 1, "/internal/send" );
    export interface Body extends RestfulEndpoint.NonAuthRequest
    {
        accountId : string;
        to        : string;
        subject   : string;
        body      : string;   // plain text or html body
    }
    export interface Response { sent : true; jobId? : string; }
    export enum Error
    {
        BAD_REQUEST           = NetworkUtils.Status.BAD_REQUEST,
        INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR,
    }
}

export default PostInternalSend;
// eof
