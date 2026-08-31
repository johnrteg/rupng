//
import { RestfulEndpoint, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";

//
// The provider's ASYNC call-status webhook (voice-8.0/3.2) - answered / no-answer / busy / voicemail / DTMF /
// hangup. The impl verifies the provider's signature, ACKs fast (200), and enqueues the raw event onto
// voice-status for the worker to normalize (voice-8.0). Same accountId+callId URL shape and auth posture as
// PostVoiceWebhookControl.
//
export class PostVoiceWebhookStatus extends RestfulEndpoint< PostVoiceWebhookStatus.Query, PostVoiceWebhookStatus.Body, PostVoiceWebhookStatus.Response >
{
    public readonly uri      : string = PostVoiceWebhookStatus.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.POST;
    public readonly access   : undefined = undefined;   // provider-signature verified, not RBAC
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    constructor( provider? : string, accountId? : string, callId? : string, body? : PostVoiceWebhookStatus.Body )
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

export namespace PostVoiceWebhookStatus
{
    export const URI : string = apiPath( "voice", 1, "/webhook/:provider/status/:accountId/:callId" );
    export interface Query { provider : string; accountId : string; callId : string; "x-twilio-signature"? : string; }
    export interface Body extends RestfulEndpoint.NonAuthRequest { [ key : string ] : unknown; }
    export interface Response { ok : boolean; }
    export enum Error { BAD_REQUEST = NetworkUtils.Status.BAD_REQUEST, FORBIDDEN = NetworkUtils.Status.FORBIDDEN }
}

export default PostVoiceWebhookStatus;
// eof
