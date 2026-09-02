//
import { PostTextingWebhook, Texting } from "@repo/api";
import { NetworkUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";
import { Webhook } from "@repo/services";
import TextingService from "../services/TextingService";

//
// The SMS/MMS provider's DLR webhook (texting-6.0) — verify signature → ACK fast → enqueue for the
// DLR worker to normalize. Uses the shared `Webhook` helper's `verify()`/`enqueue()` steps SEPARATELY
// (not `handle()`) because the ENQUEUED payload must differ from the VERIFIED one: verification needs the
// vendor's raw body (e.g. Twilio's HMAC is computed over the exact form params), while the queue needs the
// provider tagged alongside it (`{provider, payload}`) so `TextingService.processDlr` knows which
// adapter's dialect to parse — each vendor's DLR body shape differs, so this can't be inferred from the
// payload alone. Mirrors social's PostSocialWebhookImpl, which splits these steps for the same reason.
//
export class PostTextingWebhookImpl extends PostTextingWebhook
{
    private service : TextingService;
    constructor( service : TextingService ) { super(); this.service = service; }

    public async execute( _auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        const provider : Texting.Provider = this.query.provider as Texting.Provider;
        if( !Object.values( Texting.Provider ).includes( provider ) )
            return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: `unknown provider: ${ provider }` } };

        // only the signature headers a real adapter actually checks are surfaced onto `this.query` (see
        // PostTextingWebhook.getMappings) — pass them through verbatim, the target adapter ignores the rest.
        const headers : Record<string, string | undefined> = {
            "x-twilio-signature":       this.query[ "x-twilio-signature" ],
            "telnyx-signature-ed25519": this.query[ "telnyx-signature-ed25519" ],
            "telnyx-timestamp":         this.query[ "telnyx-timestamp" ],
        };
        const body : Record<string, unknown> = ( this.body ?? {} ) as Record<string, unknown>;

        const webhook : Webhook = this.service.webhookFor( provider );
        const verified : boolean = await webhook.verify( { headers, url: TextingService.statusUrl( provider ), body } );
        if( !verified ) return { status: NetworkUtils.Status.FORBIDDEN, data: { message: "signature verification failed" } };

        const enqueued : Type.Result<void> = await webhook.enqueue( "texting-dlr", { provider, payload: body } );
        if( !enqueued.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "could not enqueue the dlr" } };
        return { status: NetworkUtils.Status.OK, data: { received: true } };
    }
}

export default PostTextingWebhookImpl;
// eof
