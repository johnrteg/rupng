//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import { Voice } from "./model/Voice";

//
// Place a TEST call to the composer's own verified number (voice-1.6). USER — the one user-facing "dial" route;
// still goes through the same enqueue/gate/dispatch path as a real send, just addressed at a single number the
// caller already owns.
//
export class PostVoiceCallsTest extends RestfulEndpoint< {}, PostVoiceCallsTest.Body, PostVoiceCallsTest.Response >
{
    public readonly uri      : string = PostVoiceCallsTest.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.POST;
    public readonly access   : Access.Role = Access.AccountRole.USER;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "testVoiceCall",
        summary:     "Place a test call",
        description: "Places a single test call to a number the composer controls, so the prompt/opt-out can be verified before a real send.",
        tags:        [ "Voice" ],
    };

    constructor( body? : PostVoiceCallsTest.Body ) { super( {}, body ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return []; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null
    {
        return {
            // "message" or "flowId" is required (one of the two) — checked in the impl, not the schema
            type: "object", additionalProperties: true, required: [ "to", "callerId" ],
            properties: {
                to:        { type: "string" },
                callerId:  { type: "string" },
                message:   { type: "object" },
                flowId:    { type: "string" },
                mergeData: { type: "object" },
                voicemailMessage: { type: "object" },
                provider:  { type: "string", enum: Object.values( Voice.Provider ) },
            },
        };
    }

    public getResponseSchema(): RestfulEndpoint.Schema | null
    {
        return { type: "object", required: [ "queued" ], properties: { queued: { type: "boolean" }, jobId: { type: "string" } } };
    }
}

export namespace PostVoiceCallsTest
{
    export const URI : string = apiPath( "voice", 1, "/calls/test" );
    export interface Body extends RestfulEndpoint.AuthRequest { to : string; callerId : string; message? : Voice.Message; flowId? : string; mergeData? : Record<string, unknown>; voicemailMessage? : Voice.Message; provider? : Voice.Provider; }
    export interface Response { queued : boolean; jobId? : string; }
    export enum Error
    {
        BAD_REQUEST  = NetworkUtils.Status.BAD_REQUEST,
        UNAUTHORIZED = NetworkUtils.Status.UNAUTHORIZED,
    }
}

export default PostVoiceCallsTest;
// eof
