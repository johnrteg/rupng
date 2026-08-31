//
import { Registration } from "@repo/api";
import type { Type } from "@repo/common";

//
// CarrierProvider — the adapter interface every carrier network provider (CNP) implements (registration-6.1),
// mirroring VoiceProvider's shape (apps/core/voice/src/providers/VoiceProvider.ts): one interface, many
// carriers. Registration APIs diverge FAR more across carriers than sending does (SPECS.md gap #1), so the
// divergence is quarantined behind these four operations and nothing above this layer branches on carrier.
//
// Every method returns a `Type.Result` and never throws — an adapter that can't reach its carrier reports a
// failed Result, which the submit/reprovision worker retries or dead-letters; it never raises.
//
export interface CarrierProvider
{
    /** Which carrier this adapter is (the factory key). */
    readonly provider : Registration.CarrierProvider;

    /** Accept a TCR campaign share on this carrier's side so it will provision numbers against the campaign
     *  (the CAMPAIGN_SHARE_ACCEPT half of the state machine). `context` carries the carrier-specific ids the
     *  share needs — resolved from the config/secret by the caller, so the adapter stays stateless. */
    shareCampaign( tcrCampaignId : string, context : CarrierContext ) : Promise<Type.Result<void>>;

    /** Acquire + associate `count` numbers to an approved campaign (registration-4.1) — the step that drives
     *  APPROVED → NUMBER_ASSOCIATED. Returns the E.164 numbers actually acquired, which may be FEWER than
     *  requested when the carrier's inventory for the area code is short (a partial success, not an error). */
    provisionNumbers( tcrCampaignId : string, count : number, context : CarrierContext, areaCode? : string ) : Promise<Type.Result<Array<string>>>;

    /** Release one E.164 number back to the carrier (a campaign teardown, or a reprovision that swaps
     *  carriers). Idempotent — releasing an already-released number is a success, not an error. */
    releaseNumber( phoneNumber : string, context : CarrierContext ) : Promise<Type.Result<void>>;

    /** The carrier's view of one number's campaign pairing — the drift check the reconciliation sweep uses to
     *  catch a number that silently fell off its campaign. */
    checkPairingStatus( phoneNumber : string, context : CarrierContext ) : Promise<Type.Result<CarrierPairingStatus>>;
}

/** A number's campaign-pairing state at the carrier — a closed set, never a free-form string, so the
 *  reconciliation logic can switch on it exhaustively. */
export enum CarrierPairingStatus
{
    OK      = "ok",        // paired and in service
    PENDING = "pending",   // the carrier has accepted the pairing but hasn't activated it yet
    INVALID = "invalid",   // the carrier does not consider this number paired to the campaign — drift
}

/** Per-call context handed to an adapter — the resolved carrier credential plus our TCR CSP identity (a
 *  carrier needs to know WHICH CSP is sharing the campaign with it). Adapters stay stateless; the caller
 *  re-resolves this fresh each time so a credential never lands at rest in a queued job payload. */
export interface CarrierContext
{
    apiKey?    : string;
    apiSecret? : string;
    accountId? : string;   // the carrier-side account id, where the carrier scopes calls by one
    cspId      : string;   // our TCR CSP identity, from RegistrationConfig.Config.cspId
}

export default CarrierProvider;
// eof
