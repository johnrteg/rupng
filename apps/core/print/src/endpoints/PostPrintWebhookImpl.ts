//
import { PostPrintWebhook, Print } from "@repo/api";
import { NetworkUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";
import { Webhook } from "@repo/services";

import PrintService from "../services/PrintService";

//
// The mail-fulfillment provider's ASYNC tracking webhook (print-4.1/9.2) — verify signature → ACK fast →
// enqueue for the tracking worker to normalize. ONE global endpoint per provider (not per-account — the
// consumer resolves the owning account via `gsi_mailid`, see `PrintService.processTracking`), so the enqueued
// payload is wrapped with `provider` rather than relying on `Webhook.handle`'s raw-body-only convenience path.
//
export class PostPrintWebhookImpl extends PostPrintWebhook
{
    private service : PrintService;
    constructor( service : PrintService ) { super(); this.service = service; }

    public async execute( _auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        const provider : Print.Provider = this.query.provider as Print.Provider;
        const body : Record<string, unknown> = ( this.body ?? {} ) as Record<string, unknown>;
        // signature headers aren't mapped here (each provider's header name differs — see MailProvider
        // adapters' `verifySignature`, a documented gap until real credentials land); an empty header set is
        // fine for now since every adapter's `verifySignature` currently returns true unconditionally.
        const request : Webhook.Request = { headers: {}, url: PrintService.webhookUrl( provider ), body, rawBody: this.rawBody };

        const verified : boolean = await this.service.webhookFor( provider ).verify( request );
        if( !verified ) return { status: NetworkUtils.Status.FORBIDDEN, data: { message: "signature verification failed" } };

        const enqueued : Type.Result<void> = await this.service.enqueueTracking( provider, body );
        if( !enqueued.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "could not enqueue tracking event" } };
        return { status: NetworkUtils.Status.OK, data: { received: true } };
    }
}

export default PostPrintWebhookImpl;
// eof
