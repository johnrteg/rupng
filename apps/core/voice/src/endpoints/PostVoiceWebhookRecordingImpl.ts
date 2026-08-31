//
import { PostVoiceWebhookRecording, Voice } from "@repo/api";
import { NetworkUtils } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";
import { Webhook } from "@repo/services";

import VoiceService from "../services/VoiceService";

//
// The provider's ASYNC recording-status webhook — verify signature → ACK fast → enqueue for the recording
// worker to download + store (+ optionally transcribe) (voice-7.0/2.3). Async/ack-fast mode of the shared
// `Webhook` helper.
//
export class PostVoiceWebhookRecordingImpl extends PostVoiceWebhookRecording
{
    private service : VoiceService;
    constructor( service : VoiceService ) { super(); this.service = service; }

    public async execute( _auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        const provider : Voice.Provider = this.query.provider as Voice.Provider;
        const accountId : string = this.query.accountId;
        const callId : string = this.query.callId;

        const request : Webhook.Request = {
            headers: { "x-twilio-signature": this.query[ "x-twilio-signature" ] },
            url:     VoiceService.recordingUrl( provider, accountId, callId ),
            body:    ( this.body ?? {} ) as Record<string, unknown>,
        };

        const result : Webhook.Result = await this.service.webhookFor( provider ).handle( request, "voice-recording" );
        if( !result.ok )
            return { status: result.status, data: { message: result.status === NetworkUtils.Status.FORBIDDEN ? "signature verification failed" : "could not enqueue recording" } };
        return { status: NetworkUtils.Status.OK, data: { ok: true } };
    }
}

export default PostVoiceWebhookRecordingImpl;
// eof
