//
import { RestfulEndpoint, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import { Print } from "./model/Print";

//
// Enqueue a SINGLE mailpiece (print-1.1/6.4). S2S ONLY — campaign/workflow's `send` node (channel=print)
// enqueues; there is no user-facing "submit one postcard" route. Returns 202 with a job pointer; the render
// worker merges + verifies the address before a single piece is committed, honoring `mailClass`/`arriveBy`.
//
export class PostPrintMailpieces extends RestfulEndpoint< {}, PostPrintMailpieces.Body, PostPrintMailpieces.Response >
{
    public readonly uri      : string = PostPrintMailpieces.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.POST;
    public readonly access   : undefined = undefined;   // S2S (INTERNAL audience) — no RBAC role
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.INTERNAL;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "enqueuePrintMailpiece",
        summary:     "Enqueue a single mailpiece",
        description: "S2S only — enqueues one mailpiece (template + merge data + recipient/sender) for render → verify → submit. Returns 202; the render worker does the rest.",
        tags:        [ "Print" ],
    };

    constructor( body? : PostPrintMailpieces.Body ) { super( {}, body ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return []; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null
    {
        return {
            type: "object", additionalProperties: true, required: [ "accountId", "type", "templateId", "recipient", "sender" ],
            properties: {
                accountId:  { type: "string" },
                type:       { type: "string", enum: Object.values( Print.MailpieceType ) },
                templateId: { type: "string" },
                mergeData:  { type: "object" },
                recipient:  { type: "object" },
                sender:     { type: "object" },
                provider:   { type: "string", enum: Object.values( Print.Provider ) },
                mailClass:  { type: "string", enum: Object.values( Print.MailClass ) },
                campaignId: { type: "string" },
                contactId:  { type: "string" },
                arriveBy:   { type: "string" },
            },
        };
    }
}

export namespace PostPrintMailpieces
{
    export const URI : string = apiPath( "print", 1, "/mailpieces" );
    export interface Body extends RestfulEndpoint.NonAuthRequest
    {
        accountId   : string;
        type        : Print.MailpieceType;
        templateId  : string;
        mergeData?  : Record<string, unknown>;
        recipient   : Print.Address;
        sender      : Print.Address;
        provider?   : Print.Provider;
        mailClass?  : Print.MailClass;
        campaignId? : string;
        contactId?  : string;
        arriveBy?   : string;
    }
    export interface Response { queued : boolean; mailId? : string; }
    export enum Error
    {
        BAD_REQUEST           = NetworkUtils.Status.BAD_REQUEST,
        INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR,
    }
}

export default PostPrintMailpieces;
// eof
