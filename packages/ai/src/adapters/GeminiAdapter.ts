//
// Google Gemini adapter — chat + vision (image tagging), Imagen image generation, Gemini TTS (text-to-
// speech), and Veo video generation, over the Generative Language REST API. JSON calls funnel through
// @repo/endpoint's RestfulService (the shared axios client); the async Veo poll + binary file download use
// native fetch (a long-running-operation + raw-bytes path RestfulService isn't shaped for). The api key is
// resolved lazily from the configured KeyProvider (the platform secret `ai-gemini`) and sent as the
// `x-goog-api-key` header.
//
// Not implemented here (Gemini CAN do them, but they need a different transport): music generation (Lyria is
// a realtime/streaming model, not a request/response call) and audio transcription (left to Whisper/ElevenLabs
// which return timed segments for captions). Add them as dedicated paths if needed.
//
import { RestfulService } from "@repo/endpoint";

import { Ai } from "../AiModel";
import { BaseAdapter, AdapterOptions, Attempt } from "./BaseAdapter";

/** A Gemini `generateContent` part — text, inline binary (image/audio in or out), or a file reference. */
interface GeminiPart
{
    text?       : string;
    inlineData? : { mimeType : string; data : string };
    inline_data? : { mime_type : string; data : string };   // snake_case echoed on some responses
}

/** A Gemini `generateContent` response (the slice we read). */
interface GenerateContentResponse
{
    candidates? : Array<{ content? : { parts? : Array<GeminiPart> }; finishReason? : string }>;
    usageMetadata? : { promptTokenCount? : number; candidatesTokenCount? : number };
}

/** A Gemini Imagen `:predict` response. */
interface PredictResponse
{
    predictions? : Array<{ bytesBase64Encoded? : string; mimeType? : string }>;
}

/** A Gemini long-running operation (Veo) — `done` flips true when the video is ready. */
interface Operation
{
    name?     : string;
    done?     : boolean;
    error?    : { code? : number; message? : string };
    response? : { generateVideoResponse? : { generatedSamples? : Array<{ video? : { uri? : string } }> } };
}

/**
 * **Google Gemini** adapter — chat/vision, Imagen (image), Gemini TTS (speech), and Veo (video) over the
 * Generative Language REST API. Operational failures are returned (`ok:false`), never thrown.
 */
export class GeminiAdapter extends BaseAdapter
{
    /** @inheritDoc */
    readonly provider     : Ai.Provider = Ai.Provider.GEMINI;
    /** Chat + structured + vision (tagging), image gen (Imagen), speech (TTS), video (Veo), transcription. */
    readonly capabilities : ReadonlySet<Ai.Capability> =
        new Set<Ai.Capability>( [ Ai.Capability.CHAT, Ai.Capability.STRUCTURED, Ai.Capability.IMAGE, Ai.Capability.SPEECH, Ai.Capability.VIDEO, Ai.Capability.TRANSCRIBE ] );

    /** API origin (RestfulService base url). */
    private static readonly BASE_URL     : string = "https://generativelanguage.googleapis.com";
    /** Default models per modality — a route's `model` (configuredModel) overrides its own modality's default. */
    private static readonly IMAGE_MODEL  : string = "gemini-2.5-flash-image";   // native image gen (:generateContent), FREE tier — Imagen (:predict) is paid-only
    private static readonly TTS_MODEL    : string = "gemini-2.5-flash-preview-tts";
    private static readonly VIDEO_MODEL  : string = "veo-3.1-generate-preview";
    /** Gemini's default prebuilt TTS voice when the request names none. */
    private static readonly DEFAULT_VOICE : string = "Kore";
    /** Video-generation poll cadence + ceiling (Veo runs for minutes; the media-generate job allows 600s). */
    private static readonly VIDEO_POLL_MS : number = 10_000;
    private static readonly VIDEO_MAX_MS  : number = 540_000;

    /** Shared HTTP client for the JSON Gemini calls. */
    private readonly http : RestfulService;

    /** The route-configured model (config/ai `model`), or undefined — each modality falls back to its own default. */
    private readonly configuredModel? : string;

    /** @param opts adapter options; the chat model defaults to `gemini-2.5-flash`. */
    constructor( opts : AdapterOptions = {} )
    {
        super( opts, "gemini-2.5-flash" );
        this.configuredModel = opts.model;
        this.http = new RestfulService( GeminiAdapter.BASE_URL );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // ── chat + vision (powers image auto-tagging) ─────────────────────────────────────────────
    override async chat( request : Ai.ChatRequest ) : Promise<Ai.ChatResponse>
    {
        this.require( Ai.Capability.CHAT );
        const key : string = await this.key();

        // Gemini splits SYSTEM turns into `systemInstruction`; USER→user, ASSISTANT→model in `contents`.
        const systemText : string = request.messages.filter( ( message : Ai.Message ) => message.role === Ai.Role.SYSTEM ).map( ( message : Ai.Message ) => message.content ).join( "\n" );
        const contents : Array<Record<string, unknown>> = request.messages
            .filter( ( message : Ai.Message ) => message.role !== Ai.Role.SYSTEM )
            .map( ( message : Ai.Message ) => ( { role: message.role === Ai.Role.ASSISTANT ? "model" : "user", parts: GeminiAdapter.messageParts( message ) } ) );

        const body : Record<string, unknown> = {
            contents,
            ...( systemText ? { systemInstruction: { parts: [ { text: systemText } ] } } : {} ),
            generationConfig: { ...( request.maxTokens ? { maxOutputTokens: request.maxTokens } : {} ), ...( request.temperature !== undefined ? { temperature: request.temperature } : {} ) },
        };

        const outcome : Attempt<GenerateContentResponse> = await this.withRetry<GenerateContentResponse>( async () : Promise<Attempt<GenerateContentResponse>> =>
        {
            const response : RestfulService.Reply = await this.http.post( GeminiAdapter.generatePath( this.model ), null, body, { "x-goog-api-key": key } );
            return response.ok
                ? { ok: true, value: response.data as GenerateContentResponse }
                : { ok: false, status: response.status, message: GeminiAdapter.failureMessage( response, "gemini chat request failed" ) };
        } );

        if( !outcome.ok )
            return { ok: false, error: { status: outcome.status, message: outcome.message }, text: "", usage: {}, model: this.model, provider: this.provider };

        const text : string = GeminiAdapter.extractText( outcome.value );
        const usage : Ai.Usage = { inputTokens: outcome.value.usageMetadata?.promptTokenCount, outputTokens: outcome.value.usageMetadata?.candidatesTokenCount };
        this.emitUsage( usage, request.metadata );
        return { ok: true, text, finish: outcome.value.candidates?.[ 0 ]?.finishReason, usage, model: this.model, provider: this.provider };
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // ── image generation ──────────────────────────────────────────────────────────────────────
    // Two paths on the same key: Gemini-NATIVE image models (`gemini-*-image`, e.g. gemini-2.5-flash-image /
    // "Nano Banana") generate via `:generateContent` and are on the FREE tier; Imagen models (`imagen-*`)
    // generate via `:predict` and are PAID-only. Pick by the resolved model id so a free key still works.
    override async image( request : Ai.ImageRequest ) : Promise<Ai.ImageResponse>
    {
        this.require( Ai.Capability.IMAGE );
        const key : string = await this.key();
        const imageModel : string = this.configuredModel ?? GeminiAdapter.IMAGE_MODEL;

        return imageModel.startsWith( "imagen" )
            ? this.imageViaPredict( request, imageModel, key )
            : this.imageViaGenerate( request, imageModel, key );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // Gemini-native image generation (`:generateContent` with an IMAGE response modality) — FREE tier. The
    // image comes back as inline base64 in a candidate part.
    private async imageViaGenerate( request : Ai.ImageRequest, model : string, key : string ) : Promise<Ai.ImageResponse>
    {
        const body : Record<string, unknown> = {
            contents:         [ { parts: [ { text: request.prompt } ] } ],
            generationConfig: { responseModalities: [ "IMAGE" ] },
        };

        const outcome : Attempt<GenerateContentResponse> = await this.withRetry<GenerateContentResponse>( async () : Promise<Attempt<GenerateContentResponse>> =>
        {
            const response : RestfulService.Reply = await this.http.post( GeminiAdapter.generatePath( model ), null, body, { "x-goog-api-key": key } );
            return response.ok
                ? { ok: true, value: response.data as GenerateContentResponse }
                : { ok: false, status: response.status, message: GeminiAdapter.failureMessage( response, "gemini image request failed" ) };
        } );

        if( !outcome.ok )
            return { ok: false, error: { status: outcome.status, message: outcome.message }, images: [], usage: {}, model, provider: this.provider };

        const images : Array<Ai.ImageOut> = GeminiAdapter.inlineImages( outcome.value );
        if( images.length === 0 )
            return { ok: false, error: { message: "gemini returned no image data" }, images: [], usage: {}, model, provider: this.provider };

        const usage : Ai.Usage = { images: images.length };
        this.emitUsage( usage, request.metadata );
        return { ok: true, images, usage, model, provider: this.provider };
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // Imagen image generation (`:predict`) — PAID-only. Kept for accounts on a paid plan / marketplace BYOK.
    private async imageViaPredict( request : Ai.ImageRequest, model : string, key : string ) : Promise<Ai.ImageResponse>
    {
        const body : Record<string, unknown> = {
            instances:  [ { prompt: request.prompt } ],
            parameters: { sampleCount: request.n ?? 1, aspectRatio: GeminiAdapter.aspectRatio( request.size ) },
        };

        const outcome : Attempt<PredictResponse> = await this.withRetry<PredictResponse>( async () : Promise<Attempt<PredictResponse>> =>
        {
            const response : RestfulService.Reply = await this.http.post( GeminiAdapter.predictPath( model ), null, body, { "x-goog-api-key": key } );
            return response.ok
                ? { ok: true, value: response.data as PredictResponse }
                : { ok: false, status: response.status, message: GeminiAdapter.failureMessage( response, "gemini image request failed" ) };
        } );

        if( !outcome.ok )
            return { ok: false, error: { status: outcome.status, message: outcome.message }, images: [], usage: {}, model, provider: this.provider };

        const images : Array<Ai.ImageOut> = ( outcome.value.predictions ?? [] )
            .map( ( prediction ) : Ai.ImageOut => ( { b64: prediction.bytesBase64Encoded } ) )
            .filter( ( image : Ai.ImageOut ) : boolean => !!image.b64 );
        if( images.length === 0 )
            return { ok: false, error: { message: "gemini returned no image data" }, images: [], usage: {}, model, provider: this.provider };

        const usage : Ai.Usage = { images: images.length };
        this.emitUsage( usage, request.metadata );
        return { ok: true, images, usage, model, provider: this.provider };
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // extract inline base64 images from a `:generateContent` response (handles camelCase + snake_case parts)
    private static inlineImages( response : GenerateContentResponse ) : Array<Ai.ImageOut>
    {
        const out : Array<Ai.ImageOut> = [];
        for( const candidate of response.candidates ?? [] )
            for( const part of candidate.content?.parts ?? [] )
            {
                const data : string | undefined = part.inlineData?.data ?? part.inline_data?.data;
                if( data ) out.push( { b64: data } );
            }
        return out;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // ── text-to-speech (Gemini TTS → PCM, wrapped as WAV) ─────────────────────────────────────
    override async speak( request : Ai.SpeakRequest ) : Promise<Ai.SpeakResponse>
    {
        this.require( Ai.Capability.SPEECH );
        const key : string = await this.key();
        const ttsModel : string = this.configuredModel ?? GeminiAdapter.TTS_MODEL;

        const body : Record<string, unknown> = {
            contents: [ { parts: [ { text: request.text } ] } ],
            generationConfig: {
                responseModalities: [ "AUDIO" ],
                speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: request.voiceId || GeminiAdapter.DEFAULT_VOICE } } },
            },
        };

        const outcome : Attempt<GenerateContentResponse> = await this.withRetry<GenerateContentResponse>( async () : Promise<Attempt<GenerateContentResponse>> =>
        {
            const response : RestfulService.Reply = await this.http.post( GeminiAdapter.generatePath( ttsModel ), null, body, { "x-goog-api-key": key } );
            return response.ok
                ? { ok: true, value: response.data as GenerateContentResponse }
                : { ok: false, status: response.status, message: GeminiAdapter.failureMessage( response, "gemini tts request failed" ) };
        } );

        if( !outcome.ok )
            return { ok: false, error: { status: outcome.status, message: outcome.message }, audio: new Uint8Array(), mime: "audio/wav", format: Ai.AudioFormat.WAV, usage: {}, model: ttsModel, provider: this.provider };

        // Gemini returns raw PCM (16-bit, 24kHz, mono) as base64 inline data — wrap it in a WAV container
        const part : GeminiPart | undefined = outcome.value.candidates?.[ 0 ]?.content?.parts?.find( ( candidate : GeminiPart ) => !!( candidate.inlineData?.data ?? candidate.inline_data?.data ) );
        const b64 : string | undefined = part?.inlineData?.data ?? part?.inline_data?.data;
        if( !b64 )
            return { ok: false, error: { message: "gemini returned no audio data" }, audio: new Uint8Array(), mime: "audio/wav", format: Ai.AudioFormat.WAV, usage: {}, model: ttsModel, provider: this.provider };

        const wav : Uint8Array = GeminiAdapter.pcmToWav( new Uint8Array( Buffer.from( b64, "base64" ) ), 24000, 1, 16 );
        const usage : Ai.Usage = { inputTokens: request.text.length };
        this.emitUsage( usage, request.metadata );
        return { ok: true, audio: wav, mime: "audio/wav", format: Ai.AudioFormat.WAV, usage, model: ttsModel, provider: this.provider };
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // ── transcription (audio understanding → transcript + best-effort timed segments) ─────────
    override async transcribe( request : Ai.TranscribeRequest ) : Promise<Ai.TranscribeResponse>
    {
        this.require( Ai.Capability.TRANSCRIBE );
        const key : string = await this.key();
        const model : string = this.configuredModel ?? this.model;

        // ask for timestamped segments as JSON so captions (SRT/VTT) have cues; fall back to plain text below.
        const instruction : string =
            "Transcribe this audio verbatim. Return ONLY a JSON array of segments, each " +
            `{ "start": <seconds>, "end": <seconds>, "text": "<spoken text>" }, no prose or code fences.` +
            ( request.language ? ` The spoken language is ${ request.language }.` : "" );
        const body : Record<string, unknown> = {
            contents: [ { parts: [ { text: instruction }, { inlineData: { mimeType: request.mime, data: Buffer.from( request.audio ).toString( "base64" ) } } ] } ],
        };

        const outcome : Attempt<GenerateContentResponse> = await this.withRetry<GenerateContentResponse>( async () : Promise<Attempt<GenerateContentResponse>> =>
        {
            const response : RestfulService.Reply = await this.http.post( GeminiAdapter.generatePath( model ), null, body, { "x-goog-api-key": key } );
            return response.ok
                ? { ok: true, value: response.data as GenerateContentResponse }
                : { ok: false, status: response.status, message: GeminiAdapter.failureMessage( response, "gemini transcribe request failed" ) };
        } );

        if( !outcome.ok )
            return { ok: false, error: { status: outcome.status, message: outcome.message }, text: "", segments: [], usage: {}, model, provider: this.provider };

        // parse the segments JSON; on any failure treat the whole reply as one untimed segment
        const raw : string = GeminiAdapter.extractText( outcome.value );
        const segments : Array<Ai.TranscriptSegment> = GeminiAdapter.parseSegments( raw );
        const text : string = segments.length > 0 ? segments.map( ( segment : Ai.TranscriptSegment ) => segment.text ).join( " " ) : raw;
        const usage : Ai.Usage = { inputTokens: outcome.value.usageMetadata?.promptTokenCount, outputTokens: outcome.value.usageMetadata?.candidatesTokenCount };
        this.emitUsage( usage, request.metadata );
        return { ok: true, text, segments, usage, model, provider: this.provider };
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // ── video generation (Veo — submit a long-running op, poll, download the bytes) ───────────
    override async video( request : Ai.VideoRequest ) : Promise<Ai.VideoResponse>
    {
        this.require( Ai.Capability.VIDEO );
        const key : string = await this.key();
        const videoModel : string = this.configuredModel ?? GeminiAdapter.VIDEO_MODEL;

        // 1. submit the generation as a long-running operation
        const body : Record<string, unknown> = { instances: [ { prompt: request.prompt } ], parameters: { aspectRatio: request.aspect ?? "16:9" } };
        const submit : RestfulService.Reply = await this.http.post( `/v1beta/models/${ videoModel }:predictLongRunning`, null, body, { "x-goog-api-key": key } );
        if( !submit.ok )
            return { ok: false, error: { status: submit.status, message: GeminiAdapter.failureMessage( submit, "gemini video submit failed" ) }, video: new Uint8Array(), mime: "video/mp4", usage: {}, model: videoModel, provider: this.provider };
        const operationName : string | undefined = ( submit.data as Operation ).name;
        if( !operationName )
            return { ok: false, error: { message: "gemini video: no operation returned" }, video: new Uint8Array(), mime: "video/mp4", usage: {}, model: videoModel, provider: this.provider };

        // 2. poll the operation until it's done (or we hit the ceiling)
        const started : number = Date.now();
        let operation : Operation | undefined;
        while( Date.now() - started < GeminiAdapter.VIDEO_MAX_MS )
        {
            await GeminiAdapter.sleep( GeminiAdapter.VIDEO_POLL_MS );
            const polled : Operation | undefined = await GeminiAdapter.getJson<Operation>( `${ GeminiAdapter.BASE_URL }/v1beta/${ operationName }`, key );
            if( polled?.done ) { operation = polled; break; }
        }
        if( !operation )
            return { ok: false, error: { message: "gemini video timed out" }, video: new Uint8Array(), mime: "video/mp4", usage: {}, model: videoModel, provider: this.provider };
        if( operation.error )
            return { ok: false, error: { status: operation.error.code, message: operation.error.message ?? "gemini video failed" }, video: new Uint8Array(), mime: "video/mp4", usage: {}, model: videoModel, provider: this.provider };

        // 3. download the produced video bytes from the returned file URI
        const uri : string | undefined = operation.response?.generateVideoResponse?.generatedSamples?.[ 0 ]?.video?.uri;
        if( !uri )
            return { ok: false, error: { message: "gemini video: no output uri" }, video: new Uint8Array(), mime: "video/mp4", usage: {}, model: videoModel, provider: this.provider };
        const bytes : Uint8Array | undefined = await GeminiAdapter.getBytes( uri, key );
        if( !bytes || bytes.length === 0 )
            return { ok: false, error: { message: "gemini video: download failed" }, video: new Uint8Array(), mime: "video/mp4", usage: {}, model: videoModel, provider: this.provider };

        this.emitUsage( {}, request.metadata );
        return { ok: true, video: bytes, mime: "video/mp4", usage: {}, model: videoModel, provider: this.provider };
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // ── helpers ───────────────────────────────────────────────────────────────────────────────

    /** `generateContent` path for a model. */
    private static generatePath( model : string ) : string { return `/v1beta/models/${ model }:generateContent`; }

    /** Imagen `:predict` path for a model. */
    private static predictPath( model : string ) : string { return `/v1beta/models/${ model }:predict`; }

    /** Build a Gemini message's `parts` — text + any inline images (vision / tagging). */
    private static messageParts( message : Ai.Message ) : Array<GeminiPart>
    {
        const parts : Array<GeminiPart> = [ { text: message.content } ];
        for( const image of message.images ?? [] )
            if( image.b64 ) parts.push( { inlineData: { mimeType: image.mime ?? "image/jpeg", data: image.b64 } } );
        return parts;
    }

    /** Join the text parts of the first candidate into the reply text. */
    private static extractText( response : GenerateContentResponse ) : string
    {
        return ( response.candidates?.[ 0 ]?.content?.parts ?? [] ).map( ( part : GeminiPart ) => part.text ?? "" ).join( "" ).trim();
    }

    /** Parse the model's timestamped-segments reply into TranscriptSegments — tolerant of code fences /
     *  surrounding prose (slices the outermost JSON array). Returns [] when it isn't parseable, so the caller
     *  falls back to the raw text as a single untimed cue. */
    private static parseSegments( raw : string ) : Array<Ai.TranscriptSegment>
    {
        const open : number = raw.indexOf( "[" ), close : number = raw.lastIndexOf( "]" );
        if( open < 0 || close <= open ) return [];
        try
        {
            const parsed : unknown = JSON.parse( raw.slice( open, close + 1 ) );
            if( !Array.isArray( parsed ) ) return [];
            return parsed
                .filter( ( entry : unknown ) : boolean => !!entry && typeof entry === "object" && typeof ( entry as { text? : unknown } ).text === "string" )
                .map( ( entry : unknown ) : Ai.TranscriptSegment =>
                {
                    const segment : { start? : unknown; end? : unknown; text? : unknown } = entry as { start? : unknown; end? : unknown; text? : unknown };
                    return { start: Number( segment.start ) || 0, end: Number( segment.end ) || 0, text: String( segment.text ).trim() };
                } );
        }
        catch { return []; }
    }

    /** Map a requested `WxH` size to the closest Imagen aspect ratio (1:1 / 4:3 / 3:4 / 16:9 / 9:16). */
    private static aspectRatio( size? : string ) : string
    {
        if( !size ) return "1:1";
        const parts : Array<number> = size.split( "x" ).map( ( value : string ) : number => Number( value ) );
        const width : number = parts[ 0 ] || 0, height : number = parts[ 1 ] || 0;
        if( width === 0 || height === 0 || width === height ) return "1:1";
        if( width > height ) return width / height >= 1.5 ? "16:9" : "4:3";
        return height / width >= 1.5 ? "9:16" : "3:4";
    }

    /** Wrap raw little-endian PCM in a minimal WAV (RIFF) container so players/probers can read it. */
    private static pcmToWav( pcm : Uint8Array, sampleRate : number, channels : number, bitsPerSample : number ) : Uint8Array
    {
        const blockAlign : number = channels * ( bitsPerSample / 8 );
        const byteRate : number = sampleRate * blockAlign;
        const header : Buffer = Buffer.alloc( 44 );
        header.write( "RIFF", 0 );
        header.writeUInt32LE( 36 + pcm.length, 4 );
        header.write( "WAVE", 8 );
        header.write( "fmt ", 12 );
        header.writeUInt32LE( 16, 16 );            // PCM fmt chunk size
        header.writeUInt16LE( 1, 20 );             // audio format = PCM
        header.writeUInt16LE( channels, 22 );
        header.writeUInt32LE( sampleRate, 24 );
        header.writeUInt32LE( byteRate, 28 );
        header.writeUInt16LE( blockAlign, 32 );
        header.writeUInt16LE( bitsPerSample, 34 );
        header.write( "data", 36 );
        header.writeUInt32LE( pcm.length, 40 );
        return new Uint8Array( Buffer.concat( [ header, Buffer.from( pcm ) ] ) );
    }

    /** GET a JSON body from the Gemini API with the key header (used for the Veo operation poll). Returns
     *  undefined on any failure — the caller keeps polling / gives up on the ceiling. Native fetch: this is a
     *  simple GET the shared RestfulService isn't needed for. */
    private static async getJson<T>( url : string, key : string ) : Promise<T | undefined>
    {
        try
        {
            const response : Response = await fetch( url, { headers: { "x-goog-api-key": key } } );
            if( !response.ok ) return undefined;
            return await response.json() as T;
        }
        catch { return undefined; }
    }

    /** GET raw bytes from a file URI with the key header (the Veo video download). Native fetch — a binary
     *  download RestfulService (JSON-oriented) isn't shaped for. */
    private static async getBytes( url : string, key : string ) : Promise<Uint8Array | undefined>
    {
        try
        {
            const response : Response = await fetch( url, { headers: { "x-goog-api-key": key } } );
            if( !response.ok ) return undefined;
            return new Uint8Array( await response.arrayBuffer() );
        }
        catch { return undefined; }
    }

    /** Extract Gemini's own error message (`{ error: { message } }`) from a non-OK reply — captured under
     *  `reply.error.data` (or `reply.data`) by RestfulService — before degrading to a generic message. */
    private static failureMessage( response : RestfulService.Reply, fallback : string ) : string
    {
        type GeminiErrorBody = { error? : { message? : string; status? : string } };
        const fromData : string | undefined = ( response.data as GeminiErrorBody | undefined )?.error?.message;
        const fromError : string | undefined = ( response.error?.data as GeminiErrorBody | undefined )?.error?.message;
        return fromData ?? fromError ?? RestfulService.error( response, fallback );
    }

    /** Resolve after `ms` (Veo poll sleep). */
    private static sleep( ms : number ) : Promise<void> { return new Promise( ( resolve ) => setTimeout( resolve, ms ) ); }
}

export default GeminiAdapter;
