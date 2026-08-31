//
// Voice — the core wire contracts for the voice SEND channel (see apps/core/voice/SPECS.md). Defined ONCE here
// in @repo/api so the voice service, its jobs, and S2S callers (campaign / workflow / transactional) share one
// vocabulary — the same shape as Email (packages/api/src/email/model/Email.ts). Covers single + batch outbound
// calls (prerecorded/TTS), an IVR flow engine (prompt → DTMF gather → branch), answering-machine detection
// (voicemail-drop vs hang-up), call recording + transcription (PII — TTL'd via S3 lifecycle, erasable via the
// `/voice/internal/erase` forget hook), and the operational call-log. STIR/SHAKEN is a documented gap, not
// modeled here yet.
//
export namespace Voice
{
    /** The telephony provider a call is placed through — the provider factory selects by this value. A closed
     *  set (one adapter per value). Only `fake` and `twilio` have an adapter today; adding another provider
     *  (Telnyx/Vonage/…) is a new adapter + a new enum value, not a new worker (voice-3.1). */
    export enum Provider
    {
        TWILIO = "twilio",
        FAKE   = "fake",
    }

    /** The operational outcome of one call (voice-7.1). Mirrors Email.Status's shape for a send channel, with
     *  voice-specific terminal states instead of email's delivery states. */
    export enum Status
    {
        QUEUED     = "queued",
        RINGING    = "ringing",
        ANSWERED   = "answered",
        NO_ANSWER  = "no-answer",
        BUSY       = "busy",
        VOICEMAIL  = "voicemail",
        FAILED     = "failed",
        SUPPRESSED = "suppressed",   // blocked before dial (quiet-hours / suppression list)
        OPTED_OUT  = "opted-out",    // the callee pressed the in-call opt-out digit
    }

    /** The spoken/played content for one call — either TTS text (synthesized once via `@repo/ai`'s
     *  `AiRouting.Modality.TEXT_TO_SPEECH` — the same provider-agnostic speech abstraction media uses for voice
     *  cloning/narration — then cached + played back as a recording) or a prerecorded audio asset (a
     *  media-hosted recording URL). Exactly one of `text`/`recordingUrl` is used per `kind`. `voiceId` is an
     *  optional override of the routed TTS provider's default voice. */
    export interface Message
    {
        kind          : "tts" | "recording";
        text?         : string;
        voiceId?      : string;
        recordingUrl? : string;
    }

    /** A single outbound call REQUEST from a caller (S2S / composer). `to` is one or more E.164 numbers (a
     *  single request may address a small explicit batch; segment/contact-list expansion is delegated to the
     *  caller for this first cut — see PostVoiceCallsBulk for the batch variant). Exactly one of `message` /
     *  `flowId` is used: `message` is a single-step call (say/play + a fixed "press 1" opt-out digit); `flowId`
     *  runs a saved multi-step IVR flow (voice-2.1) instead — the flow's entry step supplies the first prompt. */
    export interface SendRequest
    {
        accountId?        : string;              // omit for platform/system calls
        to                : Array<string>;       // E.164 destination numbers
        callerId          : string;              // the E.164 caller-ID number to dial FROM (a configured voice_numbers entry)
        message?          : Message;             // single-step call — mutually exclusive with flowId
        flowId?           : string;              // run this saved IVR flow instead of a single message
        mergeData?        : Record<string, unknown>;   // `{{ dotted.path }}` tag values merged into message/flow step text
        voicemailMessage? : Message;             // AMD (voice-2.4): played + hung up on if answered by a machine; omit to hang up silently
        campaignId?       : string;
        provider?         : Provider;            // override the resolved provider (else config default)
        schedule?         : { delaySeconds? : number };
    }

    /** One placed call's result from the provider adapter's `initiate` call. Never throws — `retryable`
     *  distinguishes a transient failure (→ retry/DLQ) from a permanent one, same contract as Email.SendResult.
     *  `status` is set only by a provider that resolves the outcome SYNCHRONOUSLY within `initiate` (the `fake`
     *  adapter, which has no real telephony round-trip); a real provider (Twilio) leaves it undefined — its
     *  outcome arrives later via the async status webhook. */
    export interface CallResult { ok : boolean; providerCallId? : string; status? : Status; error? : string; retryable? : boolean; }

    /** The operational call-log ROW (voice-7.1) — one per placed call + its outcome, the wire model for the
     *  call-log views (`GetVoiceCallsLog`/`GetVoiceCall`). For a flow-driven call, `message` holds the entry
     *  step's content (record-keeping only — `flowId`/`currentStepId` are the live source of truth the
     *  call-control webhook advances); `mergeData` is carried so each step can be rendered/merged lazily as
     *  the call progresses through the flow. */
    export interface CallLog
    {
        accountId         : string;
        callId            : string;
        to                : string;
        callerId          : string;
        provider          : Provider;
        status            : Status;
        message           : Message;
        flowId?           : string;
        currentStepId?    : string;
        mergeData?        : Record<string, unknown>;
        voicemailMessage? : Message;    // AMD (voice-2.4) — played + hung up on if the call-control webhook detects a machine
        campaignId?       : string;
        providerCallId?   : string;
        durationSec?      : number;
        optedOut?         : boolean;
        error?            : string;
        recordingKey?     : string;   // the `voice` S3 bucket object key (NOT a URL — presigned fresh on each read; PII, TTL'd via bucket lifecycle)
        transcript?       : string;   // spoken-call transcript (Ai.transcribe on the downloaded recording); PII
        createdAt         : string;
        updatedAt         : string;
    }

    // ── Retry / DLQ (voice-5.0) ───────────────────────────────────────────────────────────────────

    /** The source queues that can dead-letter (each has a `<key>-dlq` companion — voice-5.0). A closed set:
     *  one entry per SQS queue voice's CloudManifest declares with `dlq: true`. */
    export enum DlqQueue
    {
        SEND      = "voice-send",
        STATUS    = "voice-status",
        RECORDING = "voice-recording",
    }

    /** One dead-lettered message, as read back from its `<queue>-dlq` companion — `receiptHandle` + `body` are
     *  carried together so a later requeue can resend the EXACT original body without re-receiving it (a
     *  second receive would hand back a different receipt handle and reset the visibility window). */
    export interface DlqItem
    {
        queue               : DlqQueue;
        messageId           : string;
        receiptHandle       : string;
        body                : string;
        approxReceiveCount? : number;
    }

    /** A configured caller-ID / voice-capable number (voice-8.0). Numbers + STIR/SHAKEN registration will
     *  eventually be owned by `registration` (SPECS.md's gap #4); voice reads its own copy for now. */
    export interface NumberEntry { accountId : string; callerId : string; label? : string; provider : Provider; }

    // ── IVR flow engine (voice-2.1) ────────────────────────────────────────────────────────────────

    /** A DTMF-gather + branch off ONE step's prompt (voice-2.1). Speech/NLU gather is a documented gap — this
     *  first cut is DTMF-only. `branches` maps a collected digit string to the next step's id; a `"default"`
     *  key is the fallback when no digit exactly matches (else the call simply hangs up on an unmatched
     *  digit). `optOutOn` lists digits that ALWAYS suppress + end the call, checked before `branches` — the
     *  in-call opt-out (voice-4.5) works the same way regardless of which step the caller is on. */
    export interface IvrGather
    {
        numDigits?  : number;
        timeoutSec? : number;
        branches    : Record<string, string>;
        optOutOn?   : Array<string>;
    }

    /** One step of an IVR flow — play `message`, then either `gather` (collect a digit and branch) or, absent
     *  `gather`, hang up after playing (a terminal step). */
    export interface IvrStep
    {
        id      : string;
        message : Message;
        gather? : IvrGather;
    }

    /** A saved, reusable IVR flow (voice-2.1) — an abstract prompt → gather → branch graph, rendered per
     *  provider by the adapter (`ivrInstructions`) one step at a time as the call-control webhook advances
     *  through it. `entryStepId` is where a call driven by this flow starts. */
    export interface IvrFlow
    {
        id          : string;
        accountId   : string;
        name        : string;
        entryStepId : string;
        steps       : Record<string, IvrStep>;
        createdAt   : string;
        createdBy?  : string;
        updatedAt   : string;
        updatedBy?  : string;
    }
}

export default Voice;
// eof
