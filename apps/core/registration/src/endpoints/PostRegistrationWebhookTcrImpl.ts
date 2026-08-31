//
import { PostRegistrationWebhookTcr } from "@repo/api";
import { NetworkUtils } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";
import { Webhook } from "@repo/services";

import RegistrationService from "../services/RegistrationService";
import { RegistrationDomain } from "../domain/RegistrationDomain";

//
// TCR's webhook intake (registration-5.2/9.2) — brand identity/vetting + campaign submission/vetting/
// operations-status callbacks. ASYNC/ack-fast mode of the shared `Webhook` helper: verify the signature,
// enqueue the RAW payload, ACK. It deliberately does NOT call `processTcrWebhook` inline — interpretation
// (which can mean a TCR read, a carrier provisioning enqueue, and several writes) belongs in
// `RegistrationWebhookJob`, off the provider's request thread, per SPECS.md's webhooks-first design.
//
export class PostRegistrationWebhookTcrImpl extends PostRegistrationWebhookTcr
{
    private service : RegistrationService;
    constructor( service : RegistrationService ) { super(); this.service = service; }

    ////////////////////////////////////////////////////////////////////////////////////////////
    public async execute( _auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        // the HMAC is over the TRUE raw bytes, so `rawBody` (captured by RegistrationWebhookService's
        // `enableRawBodyCapture`) is what gets verified — a re-serialized body is NOT the signed payload
        const request : Webhook.Request =
        {
            headers: { "x-tcr-signature": this.query?.[ "x-tcr-signature" ] },
            url:     this.uri,
            body:    ( this.body ?? {} ) as Record<string, unknown>,
            rawBody: this.rawBody,
        };

        const handled : Webhook.Result = await this.service
            .webhookFor( RegistrationDomain.WebhookStream.TCR )
            .handle( request, RegistrationDomain.WEBHOOK_QUEUE[ RegistrationDomain.WebhookStream.TCR ] );

        if( !handled.ok )
            return { status: handled.status, data: { message: handled.status === NetworkUtils.Status.FORBIDDEN ? "signature verification failed" : "could not enqueue the callback" } };
        return { status: NetworkUtils.Status.OK, data: { ok: true } };
    }
}

export default PostRegistrationWebhookTcrImpl;
// eof
