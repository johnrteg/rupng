//
import { RestfulEndpoint, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import { Texting } from "./model/Texting";

//
// Enqueue a single SMS/MMS send (texting-1.1). S2S ONLY — campaign/workflow's `send` node
// (channel=texting) enqueues; there is no user-facing "send one text" route. Returns 202; number +
// provider are resolved at send time (deferred to a later phase — MVP cut, see SPECS.md gap register).
//
export class PostTextingSend extends RestfulEndpoint< {}, PostTextingSend.Body, PostTextingSend.Response >
{
    public readonly uri      : string = PostTextingSend.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.POST;
    public readonly access   : undefined = undefined;   // S2S (INTERNAL audience) — no RBAC role
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.INTERNAL;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "enqueueTextingSend",
        summary:     "Enqueue a single SMS/MMS send",
        description: "S2S only — enqueues one send by contactId (number/provider resolved at send time). Returns 202.",
        tags:        [ "Texting" ],
    };

    constructor( body? : PostTextingSend.Body ) { super( {}, body ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return []; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null
    {
        return {
            type: "object", additionalProperties: false, required: [ "accountId", "contactId", "idempotencyKey" ],
            properties: {
                accountId:      { type: "string" },
                contactId:      { type: "string" },
                campaignId:     { type: "string" },
                body:           { type: "string" },
                templateId:     { type: "string" },
                mediaKeys:      { type: "array", items: { type: "string" } },
                scheduleAt:     { type: "string" },
                idempotencyKey: { type: "string" },
            },
        };
    }
}

export namespace PostTextingSend
{
    export const URI : string = apiPath( "texting", 1, "/send" );
    export interface Body extends RestfulEndpoint.NonAuthRequest, Texting.SendRequest {}
    export interface Response { queued : boolean; }
    export enum Error
    {
        BAD_REQUEST           = NetworkUtils.Status.BAD_REQUEST,
        INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR,
    }
}

export default PostTextingSend;
// eof
