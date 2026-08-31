//
import { randomUUID } from "node:crypto";

import { Voice } from "@repo/api";

import { VoiceProvider, VoiceCall, VoiceContext, VoiceNormalizedStatus, IvrRender, VoiceRecordingInfo, VoiceRecordingAudio } from "../VoiceProvider";

//
// FakeVoiceAdapter — a DEV-ONLY simulated telephony provider (mirrors FakeProvider,
// apps/core/email/src/providers/adapters/FakeProvider.ts, but resolves fully IN-PROCESS rather than over HTTP:
// there is no real call leg, so there's nothing to round-trip against). `initiate` picks a config-weighted
// outcome immediately and returns it on `Voice.CallResult.status` — VoiceService writes the terminal call-log
// row straight from that result, skipping the async status-webhook path a real provider uses.
//
export class FakeVoiceAdapter implements VoiceProvider
{
    public readonly provider : Voice.Provider = Voice.Provider.FAKE;

    // weighted outcome table — arbitrary, illustrative distribution for exercising the send/log path offline
    private static readonly OUTCOMES : Array<{ status : Voice.Status; weight : number }> =
    [
        { status: Voice.Status.ANSWERED,  weight: 55 },
        { status: Voice.Status.NO_ANSWER, weight: 25 },
        { status: Voice.Status.VOICEMAIL, weight: 10 },
        { status: Voice.Status.BUSY,      weight: 10 },
    ];

    ////////////////////////////////////////////////////////////////////////////////////////////
    // pick a simulated outcome + synthesize a call id — never throws (a simulated call can't fail transport).
    public async initiate( call : VoiceCall, ctx : VoiceContext ) : Promise<Voice.CallResult>
    {
        const status : Voice.Status = FakeVoiceAdapter.pickOutcome();
        return { ok: true, providerCallId: `fake-${ randomUUID() }`, status };
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // never actually rendered — fake calls never place a real HTTP call-control round-trip. Kept for interface
    // conformance + so a future "simulate an inbound IVR digit" test harness has something to call.
    public ivrInstructions( render : IvrRender, ctx : VoiceContext ) : string
    {
        const say : string = render.message ? `<Say>${ render.message.text ?? "" }</Say>` : "";
        return render.gather ? `<Response>${ say }<Gather numDigits="${ render.gather.numDigits ?? 1 }"/></Response>` : `<Response>${ say }<Hangup/></Response>`;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // fake calls never receive a real webhook re-POST; no digits to extract.
    public collectedInput() : string | undefined { return undefined; }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // fake AMD is already resolved synchronously as a VOICEMAIL outcome in `initiate` (OUTCOMES above) — no
    // separate signal arrives on a (nonexistent) control-webhook re-POST.
    public answeredBy() : "human" | "machine" | undefined { return undefined; }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // no real status webhook arrives for a fake call; implemented for interface conformance / manual testing.
    public statusNormalize( payload : Record<string, unknown> ) : VoiceNormalizedStatus
    {
        const status : Voice.Status = ( payload.status as Voice.Status ) ?? Voice.Status.FAILED;
        return { status };
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** No real transport to forge — always accepted. */
    public verifySignature() : boolean { return true; }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // fake calls are never recorded — no real media exists to fetch.
    public recordingInfo() : VoiceRecordingInfo | undefined { return undefined; }
    public async fetchRecording() : Promise<VoiceRecordingAudio | undefined> { return undefined; }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // weighted random pick over OUTCOMES
    private static pickOutcome() : Voice.Status
    {
        const total : number = FakeVoiceAdapter.OUTCOMES.reduce( ( sum : number, entry : { status : Voice.Status; weight : number } ) : number => sum + entry.weight, 0 );
        let roll : number = Math.random() * total;
        for( const entry of FakeVoiceAdapter.OUTCOMES )
        {
            if( roll < entry.weight ) return entry.status;
            roll -= entry.weight;
        }
        return Voice.Status.ANSWERED;
    }
}

export default FakeVoiceAdapter;
// eof
