//
import twilio, { validateRequest } from "twilio";

import { Voice } from "@repo/api";

import { VoiceProvider, VoiceCall, VoiceContext, VoiceNormalizedStatus, IvrRender, VoiceRecordingInfo, VoiceRecordingAudio } from "../VoiceProvider";

//
// TwilioVoiceAdapter — the real telephony adapter for Twilio Programmable Voice (voice-3.1). `initiate` places
// the call via the REST API, pointing Twilio's call-control + status callbacks at our per-call webhook URLs
// (VoiceCall.controlUrl/statusUrl, which already carry the callId), enabling SYNCHRONOUS answering-machine
// detection (`machineDetection: "DetectMessageEnd"`, voice-2.4) when the config opts in — Twilio then DELAYS
// the initial request to `url` until detection completes, delivering the result as `AnsweredBy` on that very
// first control-webhook hit (no separate AMD webhook route needed). `ivrInstructions` renders whatever ONE
// resolved step VoiceService hands it — say/play (or nothing, for a silent hang-up) + an optional digit
// `<Gather>` (used both for the legacy "press 1 to stop" opt-out AND for a real IVR flow's branch points;
// VoiceService, not this adapter, decides which). `collectedInput`/`answeredBy` pull the caller's pressed
// digit / the AMD result out of Twilio's re-POST form fields. `verifySignature` uses Twilio's own HMAC-SHA1
// request-signature scheme.
//
export class TwilioVoiceAdapter implements VoiceProvider
{
    public readonly provider : Voice.Provider = Voice.Provider.TWILIO;

    ////////////////////////////////////////////////////////////////////////////////////////////
    // place the call via the Twilio REST API. Never throws — a client/API error becomes a retryable CallResult.
    public async initiate( call : VoiceCall, ctx : VoiceContext ) : Promise<Voice.CallResult>
    {
        if( !ctx.accountSid || !ctx.authToken ) return { ok: false, error: "twilio credentials not configured", retryable: false };

        try
        {
            const client : ReturnType<typeof twilio> = twilio( ctx.accountSid, ctx.authToken );
            const created : { sid : string } = await client.calls.create( {
                to:                   call.to,
                from:                 call.callerId,
                url:                  call.controlUrl,
                method:               "POST",
                statusCallback:       call.statusUrl,
                statusCallbackMethod: "POST",
                statusCallbackEvent:  [ "initiated", "ringing", "answered", "completed" ],
                // synchronous AMD: Twilio holds the call until it knows human vs machine, then includes
                // `AnsweredBy` on the FIRST request to `url` — see `answeredBy` below.
                ...( ctx.amdEnabled ? { machineDetection: "DetectMessageEnd" as const } : {} ),
                // whole-call recording — `recordingStatusCallback` fires once the recording finishes processing
                ...( ctx.recordingEnabled ? { record: true, recordingStatusCallback: call.recordingUrl, recordingStatusCallbackMethod: "POST" as const, recordingStatusCallbackEvent: [ "completed" ] } : {} ),
            } );
            return { ok: true, providerCallId: created.sid };
        }
        catch( error )
        {
            // a Twilio client error carries a numeric `status`; 5xx/429 are transient, everything else permanent
            const status : number | undefined = ( error as { status? : number } )?.status;
            const retryable : boolean = status === undefined || status === 429 || status >= 500;
            return { ok: false, error: String( error ), retryable };
        }
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // render ONE resolved step — say/play the message, then either a digit `<Gather>` (re-POSTs the SAME
    // control webhook URL by default — `action` is omitted) or a `<Hangup>` for a terminal step. VoiceService
    // decides gather-vs-terminal (flow branching, or the legacy fixed opt-out digit); this adapter just renders.
    public ivrInstructions( render : IvrRender, ctx : VoiceContext ) : string
    {
        const twiml : InstanceType<typeof twilio.twiml.VoiceResponse> = new twilio.twiml.VoiceResponse();

        if( render.message?.kind === "recording" && render.message.recordingUrl ) twiml.play( render.message.recordingUrl );
        else if( render.message !== undefined ) twiml.say( render.message.text ?? "" );
        // else: play NOTHING (a silent AMD hang-up with no voicemail message configured)

        if( render.gather ) twiml.gather( { numDigits: render.gather.numDigits ?? 1, method: "POST", timeout: render.gather.timeoutSec ?? 5 } );
        else twiml.hangup();

        return twiml.toString();
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // Twilio's <Gather> re-POST carries the collected digits in the `Digits` form field; absent on the
    // initial call-control request (no input yet).
    public collectedInput( body : Record<string, unknown> ) : string | undefined
    {
        return body.Digits !== undefined ? String( body.Digits ) : undefined;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // synchronous AMD (machineDetection: "DetectMessageEnd") delivers `AnsweredBy` on the FIRST control-webhook
    // request only — `human` is a clean signal; any `machine_*` value is a machine; `fax`/`unknown`/absent is
    // treated as no clear signal (undefined) so the call proceeds normally rather than risking a false positive.
    public answeredBy( body : Record<string, unknown> ) : "human" | "machine" | undefined
    {
        const answeredBy : string | undefined = body.AnsweredBy !== undefined ? String( body.AnsweredBy ) : undefined;
        if( answeredBy === "human" ) return "human";
        if( answeredBy?.startsWith( "machine" ) ) return "machine";
        return undefined;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // Twilio's CallStatus vocabulary → the platform's canonical Voice.Status. A `Digits === "1"` on the
    // call-control re-POST is the in-call opt-out (voice-4.5).
    public statusNormalize( payload : Record<string, unknown> ) : VoiceNormalizedStatus
    {
        const callStatus : string = String( payload.CallStatus ?? "" );
        const digits : string | undefined = payload.Digits !== undefined ? String( payload.Digits ) : undefined;
        const durationSec : number | undefined = payload.CallDuration !== undefined ? Number( payload.CallDuration ) : undefined;

        if( digits === "1" ) return { status: Voice.Status.OPTED_OUT, optedOut: true, durationSec };

        const MAP : Record<string, Voice.Status> =
        {
            queued:      Voice.Status.QUEUED,
            ringing:     Voice.Status.RINGING,
            "in-progress": Voice.Status.ANSWERED,
            completed:   Voice.Status.ANSWERED,
            "no-answer": Voice.Status.NO_ANSWER,
            busy:        Voice.Status.BUSY,
            failed:      Voice.Status.FAILED,
            canceled:    Voice.Status.FAILED,
        };
        return { status: MAP[ callStatus ] ?? Voice.Status.FAILED, durationSec };
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // Twilio's HMAC-SHA1 request signature (`X-Twilio-Signature`) over the full webhook URL + form params.
    public verifySignature( headers : Record<string, string | undefined>, url : string, body : Record<string, unknown>, ctx : VoiceContext ) : boolean
    {
        if( !ctx.authToken ) return false;
        const signature : string = headers[ "x-twilio-signature" ] ?? "";
        return validateRequest( ctx.authToken, signature, url, body as Record<string, string> );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // the recordingStatusCallback payload's `RecordingSid` + `RecordingDuration` (seconds); absent → no
    // recording (recording disabled, or this webhook fired for a different reason).
    public recordingInfo( payload : Record<string, unknown> ) : VoiceRecordingInfo | undefined
    {
        const recordingId : string | undefined = payload.RecordingSid !== undefined ? String( payload.RecordingSid ) : undefined;
        if( recordingId === undefined ) return undefined;
        const durationSec : number | undefined = payload.RecordingDuration !== undefined ? Number( payload.RecordingDuration ) : undefined;
        return { recordingId, durationSec };
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // download the recording's MP3 bytes from the Twilio REST API (Basic-Auth'd — recordings aren't public).
    public async fetchRecording( recordingId : string, ctx : VoiceContext ) : Promise<VoiceRecordingAudio | undefined>
    {
        if( !ctx.accountSid || !ctx.authToken ) return undefined;
        try
        {
            const url : string = `https://api.twilio.com/2010-04-01/Accounts/${ ctx.accountSid }/Recordings/${ recordingId }.mp3`;
            const auth : string = Buffer.from( `${ ctx.accountSid }:${ ctx.authToken }` ).toString( "base64" );
            const response : Response = await fetch( url, { headers: { Authorization: `Basic ${ auth }` } } );
            if( !response.ok ) return undefined;
            return { audio: new Uint8Array( await response.arrayBuffer() ), mime: "audio/mpeg" };
        }
        catch { return undefined; }
    }
}

export default TwilioVoiceAdapter;
// eof
