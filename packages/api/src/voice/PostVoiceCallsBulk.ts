//
import { RestfulEndpoint, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import { Voice } from "./model/Voice";

//
// Enqueue a BULK outbound call from an explicit recipient list (voice-1.1). S2S only, same shape as
// PostVoiceCalls — `to` simply carries the full segment expansion the caller already resolved (contact-service
// segment expansion is a documented gap, mirroring Email's `resolveSegment` TODO seam).
//
export class PostVoiceCallsBulk extends RestfulEndpoint< {}, PostVoiceCallsBulk.Body, PostVoiceCallsBulk.Response >
{
    public readonly uri      : string = PostVoiceCallsBulk.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.POST;
    public readonly access   : undefined = undefined;   // S2S (INTERNAL audience) — no RBAC role
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.INTERNAL;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "enqueueVoiceCallsBulk",
        summary:     "Enqueue a bulk outbound call",
        description: "S2S only — enqueues one call per recipient in `to`. Returns 202 with one job id per accepted recipient.",
        tags:        [ "Voice" ],
    };

    constructor( body? : PostVoiceCallsBulk.Body ) { super( {}, body ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return []; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null
    {
        return {
            type: "object", additionalProperties: true, required: [ "to", "callerId" ],
            properties: {
                to:         { type: "array" },
                callerId:   { type: "string" },
                message:    { type: "object" },
                flowId:     { type: "string" },
                mergeData:  { type: "object" },
                voicemailMessage: { type: "object" },
                campaignId: { type: "string" },
                provider:   { type: "string", enum: Object.values( Voice.Provider ) },
            },
        };
    }

    public getResponseSchema(): RestfulEndpoint.Schema | null
    {
        return {
            type: "object", required: [ "queued" ],
            properties: {
                queued: { type: "boolean" },
                jobIds: { type: "array", items: { type: "string" } },
            },
        };
    }
}

export namespace PostVoiceCallsBulk
{
    export const URI : string = apiPath( "voice", 1, "/calls/bulk" );
    export interface Body extends RestfulEndpoint.NonAuthRequest, Voice.SendRequest {}
    export interface Response { queued : boolean; jobIds : Array<string>; }
    export enum Error
    {
        BAD_REQUEST           = NetworkUtils.Status.BAD_REQUEST,
        INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR,
    }
}

export default PostVoiceCallsBulk;
// eof
