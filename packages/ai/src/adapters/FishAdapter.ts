//
// fish.audio adapter — text-to-speech (media-17). fish.audio's TTS endpoint returns RAW AUDIO BYTES, not
// JSON, so this adapter uses `fetch` directly (the shared RestfulService is JSON-oriented — no binary
// responseType); this mirrors the binary-fetch already used for provider media downloads. The api key is
// resolved lazily from the configured KeyProvider (the platform Secrets in prod/local). Voice cloning is a
// later addition (a `reference_id` from a cloned-voice model plugs straight into `SpeakRequest.voiceId`).
//
import { FileUtils } from "@repo/common";

import { Ai } from "../AiModel";
import { BaseAdapter, AdapterOptions, Attempt } from "./BaseAdapter";

/**
 * **fish.audio** adapter — text-to-speech over the `/v1/tts` endpoint. Returns synthesized audio bytes for
 * the requested {@link Ai.AudioFormat}. The api key is resolved lazily from the configured KeyProvider.
 */
export class FishAdapter extends BaseAdapter
{
    /** @inheritDoc */
    readonly provider     : Ai.Provider = Ai.Provider.FISH;
    /** Text-to-speech only (voice cloning added later). */
    readonly capabilities : ReadonlySet<Ai.Capability> = new Set<Ai.Capability>( [ Ai.Capability.SPEECH ] );

    /** API origin. */
    private static readonly BASE_URL : string = "https://api.fish.audio";
    /** Text-to-speech path. */
    private static readonly TTS_PATH : string = "/v1/tts";

    /** @param opts adapter options; `model` defaults to `speech-1.6`. */
    constructor( opts : AdapterOptions = {} )
    {
        super( opts, "speech-1.6" );
    }

    /** The mime type for an output audio format. */
    private static mimeFor( format : Ai.AudioFormat ) : string
    {
        switch( format )
        {
            case Ai.AudioFormat.MP3:  return FileUtils.Mime.AUDIO_MPEG;
            case Ai.AudioFormat.WAV:  return FileUtils.Mime.AUDIO_WAV;
            case Ai.AudioFormat.OPUS: return FileUtils.Mime.AUDIO_OPUS;
            case Ai.AudioFormat.PCM:  return FileUtils.Mime.AUDIO_PCM;
            default:                  return FileUtils.Mime.OCTET_STREAM;
        }
    }

    /** Synthesize speech from text — POST the text (+ optional voice) and read back the audio bytes. */
    override async speak( request : Ai.SpeakRequest ) : Promise<Ai.SpeakResponse>
    {
        this.require( Ai.Capability.SPEECH );
        const key : string = await this.key();
        const format : Ai.AudioFormat = request.format ?? Ai.AudioFormat.MP3;

        const outcome : Attempt<Uint8Array> = await this.withRetry<Uint8Array>( async () : Promise<Attempt<Uint8Array>> =>
        {
            try
            {
                const response : Response = await fetch( `${ FishAdapter.BASE_URL }${ FishAdapter.TTS_PATH }`, {
                    method  : "POST",
                    headers : {
                        "Authorization" : `Bearer ${ key }`,
                        "Content-Type"  : "application/json",
                        "model"         : this.model,   // fish.audio selects the TTS model via this header
                    },
                    body : JSON.stringify( {
                        text         : request.text,
                        reference_id : request.voiceId,   // a preset / cloned voice id; omit for the default voice
                        format,
                    } ),
                } );
                if( !response.ok )
                    return { ok: false, status: response.status, message: `fish.audio tts failed: ${ response.status } ${ await response.text().catch( () => "" ) }`.trim() };
                return { ok: true, value: new Uint8Array( await response.arrayBuffer() ) };
            }
            catch( error : unknown ) { return { ok: false, message: `fish.audio tts error: ${ String( error ) }` }; }
        } );

        if( !outcome.ok )
            return { ok: false, error: { status: outcome.status, message: outcome.message }, audio: new Uint8Array(), mime: FishAdapter.mimeFor( format ), format, usage: {}, model: this.model, provider: this.provider };

        // fish.audio bills by character; surface the input length as a rough usage signal.
        const usage : Ai.Usage = { inputTokens: request.text.length };
        this.emitUsage( usage, request.metadata );

        return { ok: true, audio: outcome.value, mime: FishAdapter.mimeFor( format ), format, usage, model: this.model, provider: this.provider };
    }
}
