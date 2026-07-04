//
// ElevenLabs adapter — text-to-speech / voice cloning (media-17). Like fish.audio, the TTS endpoint returns
// RAW AUDIO BYTES (not JSON), so this uses `fetch` (RestfulService is JSON-oriented). The api key is resolved
// lazily from the configured KeyProvider (the platform Secrets: `ai-elevenlabs`). Voice cloning + the sound-
// effects endpoint are follow-ons (a cloned `voiceId` plugs straight into `SpeakRequest.voiceId`).
//
import { FileUtils } from "@repo/common";

import { Ai } from "../AiModel";
import { BaseAdapter, AdapterOptions, Attempt } from "./BaseAdapter";

/**
 * **ElevenLabs** adapter — text-to-speech over `/v1/text-to-speech/{voiceId}`. Returns synthesized MP3 bytes.
 * The api key is resolved lazily from the configured KeyProvider.
 */
export class ElevenLabsAdapter extends BaseAdapter
{
    /** @inheritDoc */
    readonly provider     : Ai.Provider = Ai.Provider.ELEVENLABS;
    /** Text-to-speech + sound-effect generation + voice cloning. */
    readonly capabilities : ReadonlySet<Ai.Capability> = new Set<Ai.Capability>( [ Ai.Capability.SPEECH, Ai.Capability.SOUND, Ai.Capability.VOICE_CLONE ] );

    /** API origin. */
    private static readonly BASE_URL : string = "https://api.elevenlabs.io";
    /** A sensible default voice ("Rachel") when the request names none. */
    private static readonly DEFAULT_VOICE : string = "21m00Tcm4TlvDq8ikWAM";

    /** @param opts adapter options; `model` defaults to `eleven_multilingual_v2`. */
    constructor( opts : AdapterOptions = {} )
    {
        super( opts, "eleven_multilingual_v2" );
    }

    /** Synthesize speech — POST the text to the voice's endpoint and read back the audio bytes. */
    override async speak( request : Ai.SpeakRequest ) : Promise<Ai.SpeakResponse>
    {
        this.require( Ai.Capability.SPEECH );
        const key : string = await this.key();
        const format : Ai.AudioFormat = request.format ?? Ai.AudioFormat.MP3;
        const voiceId : string = request.voiceId || ElevenLabsAdapter.DEFAULT_VOICE;

        const outcome : Attempt<Uint8Array> = await this.withRetry<Uint8Array>( async () : Promise<Attempt<Uint8Array>> =>
        {
            try
            {
                const response : Response = await fetch( `${ ElevenLabsAdapter.BASE_URL }/v1/text-to-speech/${ voiceId }`, {
                    method  : "POST",
                    headers : { "xi-api-key": key, "Content-Type": "application/json", "Accept": "audio/mpeg" },
                    body    : JSON.stringify( { text: request.text, model_id: this.model } ),
                } );
                if( !response.ok )
                    return { ok: false, status: response.status, message: `elevenlabs tts failed: ${ response.status } ${ await response.text().catch( () => "" ) }`.trim() };
                return { ok: true, value: new Uint8Array( await response.arrayBuffer() ) };
            }
            catch( error : unknown ) { return { ok: false, message: `elevenlabs tts error: ${ String( error ) }` }; }
        } );

        // ElevenLabs streams MP3 regardless of the requested container; report mp3 unless a WAV was asked for
        const mime : string = format === Ai.AudioFormat.WAV ? FileUtils.Mime.AUDIO_WAV : FileUtils.Mime.AUDIO_MPEG;
        if( !outcome.ok )
            return { ok: false, error: { status: outcome.status, message: outcome.message }, audio: new Uint8Array(), mime, format, usage: {}, model: this.model, provider: this.provider };

        const usage : Ai.Usage = { inputTokens: request.text.length };   // ElevenLabs bills by character
        this.emitUsage( usage, request.metadata );
        return { ok: true, audio: outcome.value, mime, format, usage, model: this.model, provider: this.provider };
    }

    /** Generate a sound effect / short clip from a prompt (ElevenLabs `/v1/sound-generation`) → MP3 bytes. */
    override async sound( request : Ai.SoundRequest ) : Promise<Ai.SoundResponse>
    {
        this.require( Ai.Capability.SOUND );
        const key : string = await this.key();
        const format : Ai.AudioFormat = request.format ?? Ai.AudioFormat.MP3;

        const outcome : Attempt<Uint8Array> = await this.withRetry<Uint8Array>( async () : Promise<Attempt<Uint8Array>> =>
        {
            try
            {
                const response : Response = await fetch( `${ ElevenLabsAdapter.BASE_URL }/v1/sound-generation`, {
                    method  : "POST",
                    headers : { "xi-api-key": key, "Content-Type": "application/json", "Accept": "audio/mpeg" },
                    body    : JSON.stringify( { text: request.prompt, duration_seconds: request.durationSec } ),
                } );
                if( !response.ok )
                    return { ok: false, status: response.status, message: `elevenlabs sound failed: ${ response.status } ${ await response.text().catch( () => "" ) }`.trim() };
                return { ok: true, value: new Uint8Array( await response.arrayBuffer() ) };
            }
            catch( error : unknown ) { return { ok: false, message: `elevenlabs sound error: ${ String( error ) }` }; }
        } );

        const mime : string = FileUtils.Mime.AUDIO_MPEG;
        if( !outcome.ok )
            return { ok: false, error: { status: outcome.status, message: outcome.message }, audio: new Uint8Array(), mime, format, usage: {}, model: this.model, provider: this.provider };

        const usage : Ai.Usage = { inputTokens: request.prompt.length };
        this.emitUsage( usage, request.metadata );
        return { ok: true, audio: outcome.value, mime, format, usage, model: this.model, provider: this.provider };
    }

    /** Clone a voice from reference audio (ElevenLabs `/v1/voices/add`, multipart) → the reusable voice id. */
    override async cloneVoice( request : Ai.CloneVoiceRequest ) : Promise<Ai.CloneVoiceResponse>
    {
        this.require( Ai.Capability.VOICE_CLONE );
        const key : string = await this.key();

        const outcome : Attempt<string> = await this.withRetry<string>( async () : Promise<Attempt<string>> =>
        {
            try
            {
                const form : FormData = new FormData();
                form.append( "name", request.name );
                if( request.description ) form.append( "description", request.description );
                request.samples.forEach( ( sample, index ) =>
                    form.append( "files", new Blob( [ sample.audio as unknown as BlobPart ], { type: sample.mime } ), `sample-${ index }.${ sample.mime.includes( "wav" ) ? "wav" : "mp3" }` ) );

                const response : Response = await fetch( `${ ElevenLabsAdapter.BASE_URL }/v1/voices/add`, {
                    method: "POST", headers: { "xi-api-key": key }, body: form,
                } );
                if( !response.ok )
                    return { ok: false, status: response.status, message: `elevenlabs voice clone failed: ${ response.status } ${ await response.text().catch( () => "" ) }`.trim() };
                const voiceId : string | undefined = ( await response.json() as { voice_id? : string } ).voice_id;
                return voiceId ? { ok: true, value: voiceId } : { ok: false, message: "elevenlabs: no voice_id returned" };
            }
            catch( error : unknown ) { return { ok: false, message: `elevenlabs voice clone error: ${ String( error ) }` }; }
        } );

        if( !outcome.ok )
            return { ok: false, error: { status: outcome.status, message: outcome.message }, voiceId: "", name: request.name, provider: this.provider };
        return { ok: true, voiceId: outcome.value, name: request.name, provider: this.provider };
    }
}

export default ElevenLabsAdapter;
