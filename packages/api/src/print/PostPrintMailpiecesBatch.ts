//
import { RestfulEndpoint, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import { Print } from "./model/Print";

//
// Bulk submit a mailpiece batch for a campaign run (print-1.1/6.3). S2S ONLY. Enforces the cross-channel
// cost-cap allocation AT SUBMIT (the campaign's budget slice, [campaign](../campaign/SPECS.md) `Strategy.
// budgetSliceCents`) — a batch that would exceed its allocation is refused wholesale, not partially admitted.
//
export class PostPrintMailpiecesBatch extends RestfulEndpoint< {}, PostPrintMailpiecesBatch.Body, PostPrintMailpiecesBatch.Response >
{
    public readonly uri      : string = PostPrintMailpiecesBatch.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.POST;
    public readonly access   : undefined = undefined;   // S2S (INTERNAL audience) — no RBAC role
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.INTERNAL;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "enqueuePrintMailpiecesBatch",
        summary:     "Bulk submit a mailpiece batch",
        description: "S2S only — enqueues a batch of mailpieces sharing one template/campaign, one row per recipient. Enforces the campaign's cost-cap allocation at submit.",
        tags:        [ "Print" ],
    };

    constructor( body? : PostPrintMailpiecesBatch.Body ) { super( {}, body ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return []; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null
    {
        return {
            type: "object", additionalProperties: true, required: [ "accountId", "type", "templateId", "sender", "recipients" ],
            properties: {
                accountId:  { type: "string" },
                type:       { type: "string", enum: Object.values( Print.MailpieceType ) },
                templateId: { type: "string" },
                sender:     { type: "object" },
                provider:   { type: "string", enum: Object.values( Print.Provider ) },
                mailClass:  { type: "string", enum: Object.values( Print.MailClass ) },
                campaignId: { type: "string" },
                arriveBy:   { type: "string" },
                recipients: { type: "array" },
            },
        };
    }
}

export namespace PostPrintMailpiecesBatch
{
    export const URI : string = apiPath( "print", 1, "/mailpieces/batch" );
    /** One recipient row within a batch submit. */
    export interface RecipientRow { recipient : Print.Address; mergeData? : Record<string, unknown>; contactId? : string; }
    export interface Body extends RestfulEndpoint.NonAuthRequest
    {
        accountId   : string;
        type        : Print.MailpieceType;
        templateId  : string;
        sender      : Print.Address;
        provider?   : Print.Provider;
        mailClass?  : Print.MailClass;
        campaignId? : string;
        arriveBy?   : string;
        recipients  : Array<RecipientRow>;
    }
    export interface Response { queued : boolean; mailIds : Array<string>; }
    export enum Error
    {
        BAD_REQUEST           = NetworkUtils.Status.BAD_REQUEST,
        FORBIDDEN             = NetworkUtils.Status.FORBIDDEN,   // cost-cap allocation exceeded
        INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR,
    }
}

export default PostPrintMailpiecesBatch;
// eof
