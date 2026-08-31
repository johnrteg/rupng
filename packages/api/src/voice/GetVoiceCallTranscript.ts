//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";

//
// Spoken-call transcript for one call (voice-2.3) — text only (no timed segments in this first cut). PII —
// same erase/TTL posture as the recording it was produced from.
//
export class GetVoiceCallTranscript extends RestfulEndpoint< GetVoiceCallTranscript.Query, undefined, GetVoiceCallTranscript.Response >
{
    public readonly uri      : string = GetVoiceCallTranscript.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.GET;
    public readonly access   : Access.Role = Access.AccountRole.USER;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "getVoiceCallTranscript",
        summary:     "Get a call's transcript",
        description: "Returns the call's spoken-audio transcript, or 404 if none was produced (transcription disabled, no recording, or already erased).",
        tags:        [ "Voice" ],
    };

    constructor( callId? : string ) { super( { callId: callId ?? "" } ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return [ { field: "callId", location: RestfulEndpoint.AttrLocation.URI, required: true } ]; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null { return null; }
}

export namespace GetVoiceCallTranscript
{
    export const URI : string = apiPath( "voice", 1, "/calls/:callId/transcript" );
    export interface Query { callId : string; }
    export interface Response { transcript : string; }
    export enum Error { UNAUTHORIZED = NetworkUtils.Status.UNAUTHORIZED, NOT_FOUND = NetworkUtils.Status.NOT_FOUND }
}

export default GetVoiceCallTranscript;
// eof
