//
import RegistrationService from "./RegistrationService";

import PostRegistrationWebhookTcrImpl from "../endpoints/PostRegistrationWebhookTcrImpl";
import PostRegistrationWebhookCvImpl from "../endpoints/PostRegistrationWebhookCvImpl";

//
// WEBHOOK role — CSP/TCR + Campaign Verify callback intake ONLY (registration-12.3). It does exactly three
// things per request: verify the provider's signature, drop the raw payload on the right intake queue, and
// ACK. All interpretation happens downstream in `RegistrationWebhookJob` (registration-5.2's
// webhooks-first-then-job-processes design), which is what keeps this role's latency flat and lets it scale
// on provider traffic rather than on account API traffic.
//
// It deliberately registers NO account-facing endpoints — a provider-facing surface that could also read or
// mutate account data would be a needlessly large blast radius for an unauthenticated (signature-only) path.
//
export class RegistrationWebhookService extends RegistrationService
{
    ////////////////////////////////////////////////////////////////////////////////////////////
    constructor()
    {
        super( RegistrationService.Role.WEBHOOK );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // REPLACES the base's `formbody`-only registration (not in addition — both would claim the same content
    // types): the HMAC checks sign over the TRUE raw bytes, so raw-body capture is mandatory for this role.
    // Without it `verifyWebhook` fails closed and every callback would be rejected.
    protected override addServerRegister() : void { this.enableRawBodyCapture(); }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** Register the two provider intake endpoints (after the inherited /health + /version). */
    protected override async registerEndpoints() : Promise<void>
    {
        await super.registerEndpoints();          // keeps /health + /version
        this.register( new PostRegistrationWebhookTcrImpl( this ) );
        this.register( new PostRegistrationWebhookCvImpl( this ) );
    }
}

export default RegistrationWebhookService;
// eof
