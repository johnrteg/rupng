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
    /** Text-to-speech + sound-effect generation + voice cloning + speech-to-text (Scribe). */
    readonly capabilities : ReadonlySet<Ai.Capability> = new Set<Ai.Capability>( [ Ai.Capability.SPEECH, Ai.Capability.SOUND, Ai.Capability.VOICE_CLONE, Ai.Capability.TRANSCRIBE ] );

    /** API origin. */
    private static readonly BASE_URL : string = "https://api.elevenlabs.io";
    /** A sensible default voice ("Rachel") when the request names none. */
    private static readonly DEFAULT_VOICE : string = "21m00Tcm4TlvDq8ikWAM";
    /** The Scribe speech-to-text model used when the route pins none. */
    private static readonly TRANSCRIBE_MODEL : string = "scribe_v1";
    /** Max seconds of audio to fold into one caption segment before starting a new one. */
    private static readonly SEGMENT_MAX_SECONDS : number = 6;

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

    /** Transcribe audio to text + timed segments with ElevenLabs **Scribe** (`/v1/speech-to-text`). Multipart
     *  upload (an audio file), so this uses `fetch`. Scribe returns word-level timestamps; we fold the words
     *  into caption-sized segments (sentence breaks or {@link SEGMENT_MAX_SECONDS}) so SRT/VTT captions work. */
    override async transcribe( request : Ai.TranscribeRequest ) : Promise<Ai.TranscribeResponse>
    {
        this.require( Ai.Capability.TRANSCRIBE );
        const key : string = await this.key();
        // the configured STT model (config/ai route `model`), else Scribe's default
        const transcribeModel : string = this.opts.model ?? ElevenLabsAdapter.TRANSCRIBE_MODEL;

        const outcome : Attempt<ScribeTranscription> = await this.withRetry<ScribeTranscription>( async () : Promise<Attempt<ScribeTranscription>> =>
        {
            try
            {
                // POST the audio as multipart form-data — request word-level timestamps for caption segments
                const form : FormData = new FormData();
                form.append( "file", new Blob( [ request.audio as unknown as BlobPart ], { type: request.mime } ), `audio.${ ElevenLabsAdapter.audioExtension( request.mime ) }` );
                form.append( "model_id", transcribeModel );
                form.append( "timestamps_granularity", "word" );
                if( request.language ) form.append( "language_code", request.language );

                const response : Response = await fetch( `${ ElevenLabsAdapter.BASE_URL }/v1/speech-to-text`, {
                    method: "POST", headers: { "xi-api-key": key }, body: form,
                } );
                if( !response.ok )
                    return { ok: false, status: response.status, message: `elevenlabs transcribe failed: ${ response.status } ${ await response.text().catch( () => "" ) }`.trim() };
                return { ok: true, value: await response.json() as ScribeTranscription };
            }
            catch( error : unknown ) { return { ok: false, message: `elevenlabs transcribe error: ${ String( error ) }` }; }
        } );

        if( !outcome.ok )
            return { ok: false, error: { status: outcome.status, message: outcome.message }, text: "", segments: [], usage: {}, model: transcribeModel, provider: this.provider };

        // fold the word-level timing into caption segments, then report text + language
        const result : ScribeTranscription = outcome.value;
        const segments : Array<Ai.TranscriptSegment> = ElevenLabsAdapter.wordsToSegments( result.words ?? [] );
        const usage : Ai.Usage = {};
        this.emitUsage( usage, request.metadata );

        return { ok: true, text: result.text ?? "", segments, language: result.language_code, usage, model: transcribeModel, provider: this.provider };
    }

    /** Fold Scribe's word list into caption-sized segments — break on a sentence-ending word or once a segment
     *  spans more than {@link SEGMENT_MAX_SECONDS}. Non-word tokens (spacing/audio events) are appended to the
     *  current segment's text but never start/extend timing on their own. */
    private static wordsToSegments( words : Array<ScribeWord> ) : Array<Ai.TranscriptSegment>
    {
        const segments : Array<Ai.TranscriptSegment> = [];
        let text : string = "";
        let start : number | undefined = undefined;
        let end : number = 0;

        // walk the words, accumulating into the open segment and flushing at sentence/length boundaries
        for( const word of words )
        {
            const content : string = word.text ?? "";
            text += content;
            if( word.type === "word" )
            {
                if( start === undefined ) start = word.start ?? end;
                end = word.end ?? end;
            }
            const spansTooLong : boolean = start !== undefined && ( end - start ) >= ElevenLabsAdapter.SEGMENT_MAX_SECONDS;
            const endsSentence : boolean = /[.!?]\s*$/.test( content );
            if( start !== undefined && ( endsSentence || spansTooLong ) )
            {
                segments.push( { start, end, text: text.trim() } );
                text = "";
                start = undefined;
            }
        }
        // flush any trailing words that didn't end on a sentence boundary
        if( start !== undefined && text.trim() !== "" ) segments.push( { start, end, text: text.trim() } );
        return segments;
    }

    /** A file extension for the upload from the audio mime (Scribe keys the format off the filename). */
    private static audioExtension( mime : string ) : string
    {
        if( mime.includes( "wav" ) ) return "wav";
        if( mime.includes( "mp4" ) || mime.includes( "m4a" ) ) return "m4a";
        if( mime.includes( "webm" ) ) return "webm";
        if( mime.includes( "ogg" ) ) return "ogg";
        if( mime.includes( "flac" ) ) return "flac";
        return "mp3";
    }
}

/** One token of an ElevenLabs Scribe transcription — a spoken word (with timing) or spacing/event filler. */
interface ScribeWord
{
    text?  : string;
    start? : number;
    end?   : number;
    type?  : string;   // "word" | "spacing" | "audio_event"
}

/** Internal shape of an ElevenLabs `/v1/speech-to-text` response. */
interface ScribeTranscription
{
    text?          : string;
    language_code? : string;
    words?         : Array<ScribeWord>;
}

export default ElevenLabsAdapter;
