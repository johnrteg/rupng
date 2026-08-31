//
import { RestfulEndpoint, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";

//
// S2S forget hook (voice-9.0) — the `contact` forget fan-out calls this to erase one destination's PII ahead
// of the bucket-lifecycle TTL: purges every matching call-log row's recording (S3 object) + transcript, and
// obfuscates the `to` number on those rows (the row itself is kept — it's the operational call-log, not the
// PII payload). Idempotent — erasing an already-erased/unknown number is a no-op, not an error.
//
export class PostVoiceInternalErase extends RestfulEndpoint< {}, PostVoiceInternalErase.Body, PostVoiceInternalErase.Response >
{
    public readonly uri      : string = PostVoiceInternalErase.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.POST;
    public readonly access   : undefined = undefined;   // S2S (INTERNAL audience) — no RBAC role
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.INTERNAL;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "eraseVoiceContact",
        summary:     "Erase a destination's call recordings/transcripts",
        description: "S2S forget hook — purges recording + transcript PII for every call to this number, ahead of the bucket-lifecycle TTL.",
        tags:        [ "Voice" ],
    };

    constructor( body? : PostVoiceInternalErase.Body ) { super( {}, body ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return []; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null
    { return { type: "object", additionalProperties: false, required: [ "accountId", "to" ], properties: { accountId: { type: "string" }, to: { type: "string" } } }; }
}

export namespace PostVoiceInternalErase
{
    export const URI : string = apiPath( "voice", 1, "/internal/erase" );
    export interface Body extends RestfulEndpoint.NonAuthRequest { accountId : string; to : string; }
    export interface Response { erased : number; }
    export enum Error { BAD_REQUEST = NetworkUtils.Status.BAD_REQUEST }
}

export default PostVoiceInternalErase;
// eof
