//
import { RestfulEndpoint, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import { Voice } from "./model/Voice";

//
// Enqueue a SINGLE outbound call (voice-1.1/1.3). S2S ONLY — campaign / workflow / transactional callers
// enqueue; there is no user-facing "dial" route (mirrors PostEmailSend's shape but INTERNAL, since placing a
// call is never a direct client action per SPECS.md). Returns 202 with a job pointer; the worker gates
// (quiet-hours + suppression), resolves the caller-ID + provider, and places the call.
//
export class PostVoiceCalls extends RestfulEndpoint< {}, PostVoiceCalls.Body, PostVoiceCalls.Response >
{
    public readonly uri      : string = PostVoiceCalls.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.POST;
    public readonly access   : undefined = undefined;   // S2S (INTERNAL audience) — no RBAC role
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.INTERNAL;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "enqueueVoiceCall",
        summary:     "Enqueue a single outbound call",
        description: "S2S only — enqueues a single automated outbound call (prerecorded/TTS message, optional IVR opt-out). Returns 202; the worker gates (quiet-hours/suppression), resolves the caller-ID + provider, and places the call.",
        tags:        [ "Voice" ],
    };

    constructor( body? : PostVoiceCalls.Body ) { super( {}, body ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return []; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null
    {
        return {
            // "message" or "flowId" is required (one of the two) — checked in the impl, not the schema, same
            // as PostEmailSend's loose body validation (the worker/impl does the full business-rule check)
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
                queued: { type: "boolean", description: "Whether the call was accepted + enqueued." },
                jobId:  { type: "string",  description: "The enqueued job id (for correlation)." },
            },
        };
    }
}

export namespace PostVoiceCalls
{
    export const URI : string = apiPath( "voice", 1, "/calls" );
    export interface Body extends RestfulEndpoint.NonAuthRequest, Voice.SendRequest {}
    export interface Response { queued : boolean; jobId? : string; }
    export enum Error
    {
        BAD_REQUEST           = NetworkUtils.Status.BAD_REQUEST,
        INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR,
    }
}

export default PostVoiceCalls;
// eof
