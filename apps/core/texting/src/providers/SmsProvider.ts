//
import { Texting } from "@repo/api";

//
// SmsProvider — the adapter interface every SMS/MMS transport implements (texting-3.1/20.1), mirroring
// MailProvider (print) / EmailProvider (email): one interface, many CPaaS vendors. A concrete adapter
// sends a rendered message to the vendor and normalizes the vendor's DLR-webhook vocabulary. Selected +
// instantiated by the SmsFactory; the resolved credential is injected per-call via `SmsContext` so
// adapters stay stateless. MVP cut — only `send` + `normalizeStatus` + `verifySignature` (no inbound
// normalization yet; see SPECS.md gap register for what's deferred).
//
export interface SmsProvider
{
    /** Which provider this adapter is (the factory key). */
    readonly provider : Texting.Provider;

    /** Which `Texting.MessageType`s this adapter can actually put on the wire — `TextingService` checks
     *  this before attempting RCS (or any future channel) rather than guessing from the `Provider` enum,
     *  so an adapter that hasn't wired up a channel yet just omits it and the service falls back to SMS. */
    readonly capabilities : Set<Texting.MessageType>;

    /** Fine-grained RCS constraints (carousel support, card/suggestion caps) — `SmsFactory.selectForRcs`
     *  uses this to pick a provider that can actually carry a given `Texting.RcsContent`, not just one
     *  that supports RCS AT ALL. `undefined` on any adapter whose `capabilities` omits `RCS`. */
    readonly rcsLimits? : Texting.RcsLimits;

    /** Put one message on the wire. NEVER throws — returns a result whose `retryable` distinguishes a
     *  transient failure (→ retry/DLQ) from a permanent one. */
    send( req : Texting.OutboundRequest, ctx : SmsContext ) : Promise<Texting.AdapterSendResult>;

    /** Normalize this provider's DLR-webhook payload into the UDF `DeliveryStatus` vocabulary. */
    normalizeStatus( payload : Record<string, unknown> ) : Texting.NormalizedEvent;

    /** Verify an inbound webhook's signature against this provider's scheme (mirrors voice's
     *  `VoiceProvider.verifySignature` — `url`/`body` cover URL-signed schemes like Twilio, `ctx` carries the
     *  credential the scheme needs). `fake` always returns true. */
    verifySignature( headers : Record<string, string | undefined>, url : string, body : Record<string, unknown>, ctx : SmsContext ) : boolean;
}

/** Per-call context handed to an adapter — the resolved credential (an opaque secret payload; each
 *  provider's own adapter knows its shape) plus the DLR webhook URL to hand the vendor at send time
 *  (`TextingService.statusUrl` — only Twilio/SignalWire's `send` use it; every other adapter ignores it). */
export interface SmsContext { secret? : Record<string, unknown>; statusCallbackUrl? : string; }

export default SmsProvider;
// eof
