//
import { PostVoiceWebhookControl, Voice } from "@repo/api";
import { NetworkUtils } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";
import { Webhook } from "@repo/services";

import VoiceService from "../services/VoiceService";

//
// The provider's SYNCHRONOUS call-control webhook — verify signature → render the next IVR step
// (voice-2.1/3.2). Sync mode of the shared `Webhook` helper: `verify()` alone (no enqueue) — Twilio needs
// TwiML back on THIS response, so there's nothing to hand off to a queue.
//
export class PostVoiceWebhookControlImpl extends PostVoiceWebhookControl
{
    private service : VoiceService;
    constructor( service : VoiceService ) { super(); this.service = service; }

    public async execute( _auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        const provider : Voice.Provider = this.query.provider as Voice.Provider;
        const accountId : string = this.query.accountId;
        const callId : string = this.query.callId;

        const body : Record<string, unknown> = ( this.body ?? {} ) as Record<string, unknown>;
        const request : Webhook.Request = { headers: { "x-twilio-signature": this.query[ "x-twilio-signature" ] }, url: VoiceService.controlUrl( provider, accountId, callId ), body };

        const verified : boolean = await this.service.webhookFor( provider ).verify( request );
        if( !verified ) return { status: NetworkUtils.Status.FORBIDDEN, data: { message: "signature verification failed" } };

        const twiml : string | undefined = await this.service.ivrStep( accountId, callId, provider, body );
        if( twiml === undefined ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "call not found" }, contentType: NetworkUtils.MimeType.JSON };

        return { status: NetworkUtils.Status.OK, data: twiml, contentType: NetworkUtils.MimeType.XML };
    }
}

export default PostVoiceWebhookControlImpl;
// eof
