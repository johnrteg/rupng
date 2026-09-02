//
import { Print } from "@repo/api";

//
// MailProvider — the adapter interface every mail-fulfillment provider implements (print-3.2/9.5), mirroring
// VoiceProvider's shape (apps/core/voice/src/providers/VoiceProvider.ts): one interface, many carriers. A
// concrete adapter submits a rendered mailpiece to the vendor, normalizes the vendor's tracking-webhook
// vocabulary, and verifies the vendor's webhook signature. Selected + instantiated by the MailFactory; the
// resolved credential is injected per-call via `MailContext` so adapters stay stateless. This factory is
// INDEPENDENT of the `AddressVerifier` factory (print-2.6) — a mail provider never verifies addresses itself
// here, even though PostGrid/Lob can ALSO act as an AddressVerifier source (a separate adapter/registration).
//
export interface MailProvider
{
    /** Which provider this adapter is (the factory key). */
    readonly provider : Print.Provider;

    /** Submit ONE rendered mailpiece to the vendor for print + mail. NEVER throws — returns a `MailSubmitResult`
     *  whose `retryable` distinguishes a transient failure (→ retry/DLQ) from a permanent one. */
    submit( piece : MailSubmission, ctx : MailContext ) : Promise<MailSubmitResult>;

    /** Normalize this provider's inbound tracking-webhook payload into a canonical `TrackingStatus`. */
    trackingNormalize( payload : Record<string, unknown> ) : MailNormalizedTracking;

    /** Verify an inbound webhook's signature against this provider's scheme. `fake` always returns true (no
     *  real transport to forge). */
    verifySignature( headers : Record<string, string | undefined>, url : string, body : Record<string, unknown>, ctx : MailContext ) : boolean;
}

/** One rendered mailpiece, ready to hand to a provider's `submit`. `pdfKey` is the S3 object key of the
 *  print-ready PDF (already rendered by `PrintService.renderProof`/render pipeline) — the adapter presigns +
 *  streams it, or (for a real vendor) posts a byte payload; `fake` never touches it. */
export interface MailSubmission
{
    mailId      : string;
    type        : Print.MailpieceType;
    mailClass   : Print.MailClass;
    recipient   : Print.Address;
    sender      : Print.Address;
    pdfUrl      : string;   // a short-lived presigned GET URL to the rendered PDF (or provider template ref)
    webhookUrl  : string;   // where the provider should POST tracking events for this piece
}

/** Per-call context handed to an adapter — the resolved credential (an opaque secret payload; each provider's
 *  own adapter knows its shape). */
export interface MailContext { secret? : Record<string, unknown>; }

/** The result of a `submit` call. */
export interface MailSubmitResult { ok : boolean; providerRefId? : string; costEstimateCents? : number; error? : string; retryable? : boolean; }

/** A provider's inbound tracking event, normalized to the platform's vocabulary. */
export interface MailNormalizedTracking { mailId? : string; status : Print.TrackingStatus; occurredAt : string; providerEventId? : string; }

export default MailProvider;
// eof
