//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";

//
// Recording playback for one call (voice-7.0) — a short-lived presigned S3 GET URL, re-resolved fresh on every
// read (the stored `recordingKey` is an S3 object key, never a durable URL). PII — audited via the normal
// request-log path; TTL'd at the bucket level (see apps/core/voice/SPECS.md), erasable via the
// `/voice/internal/erase` forget hook.
//
export class GetVoiceCallRecording extends RestfulEndpoint< GetVoiceCallRecording.Query, undefined, GetVoiceCallRecording.Response >
{
    public readonly uri      : string = GetVoiceCallRecording.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.GET;
    public readonly access   : Access.Role = Access.AccountRole.USER;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "getVoiceCallRecording",
        summary:     "Get a call's recording playback URL",
        description: "Returns a short-lived presigned URL to the call's recording, or 404 if none was captured (recording disabled, still processing, or already erased).",
        tags:        [ "Voice" ],
    };

    constructor( callId? : string ) { super( { callId: callId ?? "" } ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return [ { field: "callId", location: RestfulEndpoint.AttrLocation.URI, required: true } ]; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null { return null; }
}

export namespace GetVoiceCallRecording
{
    export const URI : string = apiPath( "voice", 1, "/calls/:callId/recording" );
    export interface Query { callId : string; }
    export interface Response { recordingUrl : string; }
    export enum Error { UNAUTHORIZED = NetworkUtils.Status.UNAUTHORIZED, NOT_FOUND = NetworkUtils.Status.NOT_FOUND }
}

export default GetVoiceCallRecording;
// eof
