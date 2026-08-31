//
import { RestfulEndpoint, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";

//
// The provider's ASYNC recording-status webhook (voice-7.0/2.3) — fires once a call recording finishes
// processing. The impl verifies the provider's signature, ACKs fast (200), and enqueues the raw event onto
// voice-recording for the worker to download the audio (S3-store it) + optionally transcribe. Same
// accountId+callId URL shape and auth posture as PostVoiceWebhookStatus.
//
export class PostVoiceWebhookRecording extends RestfulEndpoint< PostVoiceWebhookRecording.Query, PostVoiceWebhookRecording.Body, PostVoiceWebhookRecording.Response >
{
    public readonly uri      : string = PostVoiceWebhookRecording.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.POST;
    public readonly access   : undefined = undefined;   // provider-signature verified, not RBAC
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    constructor( provider? : string, accountId? : string, callId? : string, body? : PostVoiceWebhookRecording.Body )
    { super( { provider: provider ?? "", accountId: accountId ?? "", callId: callId ?? "" }, body ); }

    public getMappings(): Array<RestfulEndpoint.FieldMap>
    {
        return [
            { field: "provider",  location: RestfulEndpoint.AttrLocation.URI, required: true },
            { field: "accountId", location: RestfulEndpoint.AttrLocation.URI, required: true },
            { field: "callId",    location: RestfulEndpoint.AttrLocation.URI, required: true },
            { field: "x-twilio-signature", location: RestfulEndpoint.AttrLocation.HEADER, required: false },
        ];
    }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null { return { type: "object", additionalProperties: true }; }
}

export namespace PostVoiceWebhookRecording
{
    export const URI : string = apiPath( "voice", 1, "/webhook/:provider/recording/:accountId/:callId" );
    export interface Query { provider : string; accountId : string; callId : string; "x-twilio-signature"? : string; }
    export interface Body extends RestfulEndpoint.NonAuthRequest { [ key : string ] : unknown; }
    export interface Response { ok : boolean; }
    export enum Error { BAD_REQUEST = NetworkUtils.Status.BAD_REQUEST, FORBIDDEN = NetworkUtils.Status.FORBIDDEN }
}

export default PostVoiceWebhookRecording;
// eof
