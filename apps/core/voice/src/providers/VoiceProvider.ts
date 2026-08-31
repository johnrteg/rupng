//
import { Voice } from "@repo/api";

//
// VoiceProvider — the adapter interface every telephony provider implements (voice-3.2), mirroring
// EmailProvider's shape (apps/core/email/src/providers/EmailProvider.ts): one interface, many carriers. A
// concrete adapter maps a gated `VoiceCall` to the vendor's call-control API, renders the next IVR step in the
// vendor's own dialect (TwiML for Twilio), normalizes the vendor's status vocabulary, and verifies the
// vendor's webhook signature. Selected + instantiated by the VoiceFactory; the resolved credential is injected
// per-call via `VoiceContext` so adapters stay stateless.
//
export interface VoiceProvider
{
    /** Which provider this adapter is (the factory key). */
    readonly provider : Voice.Provider;

    /** Place ONE outbound call. NEVER throws — it returns a `Voice.CallResult` whose `retryable` distinguishes
     *  a transient failure (→ retry/DLQ) from a permanent one. */
    initiate( call : VoiceCall, ctx : VoiceContext ) : Promise<Voice.CallResult>;

    /** Render ONE resolved IVR step in this provider's own call-control dialect (TwiML `<Say>`/`<Play>`/
     *  `<Gather>`/`<Hangup>` for Twilio) — `render.gather` present = collect a digit and re-POST the same
     *  control webhook; absent = a terminal step (play then hang up). Called synchronously from the
     *  call-control webhook — the one shape-delta from every other channel's fire-and-forget webhooks.
     *  VoiceService has ALREADY resolved which step this is (flow branching / the legacy single-message +
     *  opt-out gather) — the adapter only renders, it never sees the flow graph. */
    ivrInstructions( render : IvrRender, ctx : VoiceContext ) : string;

    /** Extract the caller's collected DTMF/speech input from a call-control webhook re-POST (e.g. Twilio's
     *  `Digits` form field), or undefined for the INITIAL control request (no input yet — render the entry/
     *  current step fresh). Provider-specific field names stay isolated here, out of `VoiceService`. */
    collectedInput( body : Record<string, unknown> ) : string | undefined;

    /** Answering-machine detection (voice-2.4) — extract this provider's AMD signal from a call-control webhook
     *  request, normalized to `"human"` / `"machine"` / undefined (no signal — AMD disabled, provider doesn't
     *  support it, or this isn't the request that carries it). `fake` never returns `"machine"` here since it
     *  already resolves VOICEMAIL as a synchronous `initiate` outcome (see FakeVoiceAdapter) — this hook is for
     *  a real provider's async/sync detection delivered ON the control webhook. */
    answeredBy( body : Record<string, unknown> ) : "human" | "machine" | undefined;

    /** Normalize this provider's inbound status-webhook payload into a canonical outcome. */
    statusNormalize( payload : Record<string, unknown> ) : VoiceNormalizedStatus;

    /** Verify an inbound webhook's signature against this provider's scheme (HMAC/Ed25519/JWT — see
     *  SPECS.md's per-provider signature table). `fake` always returns true (no real transport to forge). */
    verifySignature( headers : Record<string, string | undefined>, url : string, body : Record<string, unknown>, ctx : VoiceContext ) : boolean;

    /** Extract this provider's recording identifier + duration from a recording-status webhook payload, or
     *  undefined if the payload carries no recording (or recording isn't supported). `fake` never has a real
     *  recording, so it always returns undefined. */
    recordingInfo( payload : Record<string, unknown> ) : VoiceRecordingInfo | undefined;

    /** Download the recorded audio bytes for a recording id resolved by {@link recordingInfo}. Returns
     *  undefined on any failure (missing credentials, network error, 404) — the caller logs + moves on rather
     *  than failing the whole recording-processing job. */
    fetchRecording( recordingId : string, ctx : VoiceContext ) : Promise<VoiceRecordingAudio | undefined>;
}

/** A single outbound call, gated + resolved, ready to hand to a provider's `initiate`. `controlUrl`/`statusUrl`
 *  are the webhook URLs THIS call's provider should call back — they carry the `callId` so the webhook handler
 *  can resolve the call without depending on a provider-specific call identifier in the payload. */
export interface VoiceCall
{
    callId       : string;
    to           : string;
    callerId     : string;
    message      : Voice.Message;
    controlUrl   : string;
    statusUrl    : string;
    recordingUrl : string;   // where the provider POSTs the recording-status event, if `ctx.recordingEnabled`
}

/** Per-call context handed to an adapter — the resolved credential (Twilio account SID + auth token; other
 *  key-auth providers would carry their own fields here as they're added), plus the config-level AMD /
 *  recording toggles. */
export interface VoiceContext { accountSid? : string; authToken? : string; amdEnabled? : boolean; recordingEnabled? : boolean; }

/** A recording's provider-native id + duration, extracted from a recording-status webhook payload. */
export interface VoiceRecordingInfo { recordingId : string; durationSec? : number; }

/** Downloaded recording audio, ready to store. */
export interface VoiceRecordingAudio { audio : Uint8Array; mime : string; }

/** ONE resolved IVR step, ready for a provider to render — VoiceService has already worked out which message
 *  plays (if any — undefined means play NOTHING, e.g. a silent AMD hang-up with no voicemail message
 *  configured) and whether there's a next gather (flow branching, or the legacy single-message + opt-out
 *  gather); the adapter's job is purely "render this in my dialect", not to interpret the flow. */
export interface IvrRender { message? : Voice.Message; gather? : { numDigits? : number; timeoutSec? : number }; }

/** A provider's inbound status event, normalized to the platform's vocabulary. */
export interface VoiceNormalizedStatus { status : Voice.Status; durationSec? : number; optedOut? : boolean; error? : string; }

export default VoiceProvider;
// eof
