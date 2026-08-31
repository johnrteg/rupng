//
import { PostRegistrationWebhookCv } from "@repo/api";
import { NetworkUtils } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";
import { Webhook } from "@repo/services";

import RegistrationService from "../services/RegistrationService";
import { RegistrationDomain } from "../domain/RegistrationDomain";

//
// Campaign Verify's webhook intake (registration-11.3/9.2) — political-brand vetting callbacks, bridged into
// TCR's own vetting via an imported token. Same ack-fast posture as the TCR intake: verify → enqueue → ACK,
// with `processCvWebhook` running downstream in `RegistrationWebhookJob`.
//
// CV gets its OWN queue rather than sharing TCR's so a stall on one provider's stream can't head-of-line
// block the other's — the two have very different volumes and very different latency profiles.
//
export class PostRegistrationWebhookCvImpl extends PostRegistrationWebhookCv
{
    private service : RegistrationService;
    constructor( service : RegistrationService ) { super(); this.service = service; }

    ////////////////////////////////////////////////////////////////////////////////////////////
    public async execute( _auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        const request : Webhook.Request =
        {
            headers: { "x-cv-signature": this.query?.[ "x-cv-signature" ] },
            url:     this.uri,
            body:    ( this.body ?? {} ) as Record<string, unknown>,
            rawBody: this.rawBody,
        };

        const handled : Webhook.Result = await this.service
            .webhookFor( RegistrationDomain.WebhookStream.CV )
            .handle( request, RegistrationDomain.WEBHOOK_QUEUE[ RegistrationDomain.WebhookStream.CV ] );

        if( !handled.ok )
            return { status: handled.status, data: { message: handled.status === NetworkUtils.Status.FORBIDDEN ? "signature verification failed" : "could not enqueue the callback" } };
        return { status: NetworkUtils.Status.OK, data: { ok: true } };
    }
}

export default PostRegistrationWebhookCvImpl;
// eof
