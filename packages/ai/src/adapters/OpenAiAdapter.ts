//
// OpenAI adapter — chat + structured + image generation (DALL·E). HTTP goes through @repo/endpoint's
// RestfulService (the shared axios client) so every external call funnels through one place — never
// raw fetch. The api key is resolved lazily from the configured KeyProvider (KMS by default).
//
import { RestfulService } from "@repo/endpoint";

import { Ai } from "../AiModel";
import { BaseAdapter, AdapterOptions, Attempt } from "./BaseAdapter";

/** Internal shape of an OpenAI /v1/chat/completions response. */
interface ChatCompletion
{
    /** Reply choices (the first is used). */
    choices? : Array<{ message? : { content? : string }; finish_reason? : string }>;
    /** Token usage. */
    usage?   : { prompt_tokens? : number; completion_tokens? : number };
}

/** Internal shape of an OpenAI /v1/images/generations response. */
interface ImageGeneration
{
    /** Generated images (base64 and/or url). */
    data? : Array<{ b64_json? : string; url? : string }>;
}

/**
 * **OpenAI direct** adapter — chat, structured, and image generation (DALL·E) over
 * {@link RestfulService}. The api key is resolved lazily from the configured {@link KeyProvider}
 * (KMS by default).
 */
export class OpenAiAdapter extends BaseAdapter
{
    /** @inheritDoc */
    readonly provider     : Ai.Provider = Ai.Provider.OPENAI;
    /** Chat + structured + image + transcription (Whisper). */
    readonly capabilities : ReadonlySet<Ai.Capability> =
        new Set<Ai.Capability>( [ Ai.Capability.CHAT, Ai.Capability.STRUCTURED, Ai.Capability.IMAGE, Ai.Capability.TRANSCRIBE ] );

    /** API origin (RestfulService base url). */
    private static readonly BASE_URL    : string = "https://api.openai.com";
    /** Chat completions path. */
    private static readonly CHAT_PATH   : string = "/v1/chat/completions";
    /** Image generation path. */
    private static readonly IMAGE_PATH  : string = "/v1/images/generations";
    /** Audio transcription (Whisper) path. */
    private static readonly TRANSCRIBE_PATH  : string = "/v1/audio/transcriptions";
    /** Transcription model. */
    private static readonly TRANSCRIBE_MODEL : string = "whisper-1";
    /** Image model used by {@link OpenAiAdapter.image} (independent of the chat `model`). `gpt-image-1` is the
     *  current default — always returns base64 and does NOT accept a `response_format` param (dall-e-* did;
     *  project keys without dall-e access reject it). */
    private static readonly IMAGE_MODEL : string = "gpt-image-1";

    /** Shared HTTP client for all calls to the OpenAI API. */
    private readonly http : RestfulService;

    /** The EXPLICITLY-configured model from the route (config/ai `model`), or undefined. Kept separate from
     *  `this.model` (which defaults to the chat model) so image/transcribe can honor a configured model while
     *  falling back to their OWN capability default — a single provider serves multiple modalities/models. */
    private readonly configuredModel? : string;

    /** @param opts adapter options; the chat `model` defaults to `gpt-4o-mini`. */
    constructor( opts : AdapterOptions = {} )
    {
        super( opts, "gpt-4o-mini" );
        this.configuredModel = opts.model;
        this.http = new RestfulService( OpenAiAdapter.BASE_URL );
    }

    /** The OpenAI `content` for a message — plain text, or content-parts (text + image_url) when the message
     *  carries images (vision). A b64 image becomes a `data:` URL. */
    private static messageContent( message : Ai.Message ) : string | Array<Record<string, unknown>>
    {
        if( !message.images || message.images.length === 0 ) return message.content;
        const parts : Array<Record<string, unknown>> = [ { type: "text", text: message.content } ];
        for( const image of message.images )
        {
            const url : string = image.url ?? `data:${ image.mime ?? "image/jpeg" };base64,${ image.b64 ?? "" }`;
            parts.push( { type: "image_url", image_url: { url } } );
        }
        return parts;
    }

    /** Build a diagnostic failure message from a non-OK reply — preferring OpenAI's own body error
     *  (`{ error: { message } }`), which carries the REAL reason (bad size, model access, billing, moderation…).
     *  On a non-2xx, RestfulService throws + captures the response body under `reply.error.data` (its top-level
     *  message/code/type are stripped, but OpenAI's are NESTED under `.error`), and leaves `reply.data` unset.
     *  So dig BOTH `reply.data.error.message` and `reply.error.data.error.message` before degrading to the
     *  generic `RestfulService.error` ("server error"). */
    /** Map a requested WxH to the closest size the given OpenAI image model actually accepts (each model has a
     *  different valid set): dall-e-2 = squares only; dall-e-3 = 1024² / 1792×1024 / 1024×1792; gpt-image-1 =
     *  1024² / 1536×1024 / 1024×1536. Preserves the requested orientation. */
    private static normalizeSize( model : string, size : string ) : string
    {
        const parts : Array<number> = size.split( "x" ).map( ( value : string ) : number => Number( value ) );
        const width : number = parts[ 0 ] || 0;
        const height : number = parts[ 1 ] || 0;
        const landscape : boolean = width > height;
        const portrait : boolean = height > width;
        if( model.startsWith( "dall-e-2" ) ) return "1024x1024";
        if( model.startsWith( "dall-e-3" ) ) return landscape ? "1792x1024" : portrait ? "1024x1792" : "1024x1024";
        return landscape ? "1536x1024" : portrait ? "1024x1536" : "1024x1024";   // gpt-image-1 (+ default)
    }

    /** Map the provider-agnostic quality tier (low/medium/high) to the given model's native `quality` value:
     *  gpt-image-1 takes low/medium/high directly; dall-e-3 takes standard/hd (low/medium → standard, high →
     *  hd); dall-e-2 has no quality param (returns undefined → omitted). */
    private static normalizeQuality( model : string, quality? : string ) : string | undefined
    {
        if( !quality ) return undefined;
        if( model.startsWith( "dall-e-2" ) ) return undefined;                       // no quality knob
        if( model.startsWith( "dall-e-3" ) ) return quality === "high" ? "hd" : "standard";
        return quality;                                                             // gpt-image-1: low | medium | high
    }

    private static failureMessage( response : RestfulService.Reply, fallback : string ) : string
    {
        // OpenAI wraps error details in { error: { message, code, type } }; try the success-data slot first
        // (unexpected 2xx with an error body), then the error-data slot (the normal non-2xx path).
        type OpenAiBody = { error? : { message? : string; code? : string; type? : string } };
        const fromData : string | undefined = ( response.data as OpenAiBody | undefined )?.error?.message;
        const fromError : string | undefined = ( response.error?.data as OpenAiBody | undefined )?.error?.message;
        if( fromData  ) return fromData;
        if( fromError ) return fromError;
        // last resort: stringify the raw error data so the actual body is surfaced (non-JSON responses, HTML
        // gateway errors, etc.) rather than the generic "server error" default
        const rawData : unknown = response.error?.data;
        if( rawData !== undefined && rawData !== null )
        {
            const raw : string = typeof rawData === "string" ? rawData : JSON.stringify( rawData );
            if( raw.length > 0 ) return raw.slice( 0, 300 );   // cap at 300 chars — enough to diagnose
        }
        return RestfulService.error( response, fallback );
    }

    /** Post the conversation to chat/completions and return the first choice's text. */
    override async chat( request : Ai.ChatRequest ) : Promise<Ai.ChatResponse>
    {
        this.require( Ai.Capability.CHAT );
        const key : string = await this.key();

        const outcome : Attempt<ChatCompletion> = await this.withRetry<ChatCompletion>( async () : Promise<Attempt<ChatCompletion>> =>
        {
            const response : RestfulService.Reply = await this.http.post(
                OpenAiAdapter.CHAT_PATH,
                null,
                {
                    model       : this.model,
                    messages    : request.messages.map( ( message ) => ( { role: message.role, content: OpenAiAdapter.messageContent( message ) } ) ),
                    max_tokens  : request.maxTokens,
                    temperature : request.temperature,
                    stop        : request.stop,
                },
                { authorization: `Bearer ${key}` },
            );
            return response.ok
                ? { ok: true, value: response.data as ChatCompletion }
                : { ok: false, status: response.status, message: RestfulService.error( response, "openai request failed" ) };
        } );

        if( !outcome.ok )
            return { ok: false, error: { status: outcome.status, message: outcome.message }, text: "", usage: {}, model: this.model, provider: this.provider };

        const completion : ChatCompletion = outcome.value;
        const choice : { message? : { content? : string }; finish_reason? : string } | undefined = completion.choices?.[ 0 ];
        const usage : Ai.Usage = { inputTokens: completion.usage?.prompt_tokens, outputTokens: completion.usage?.completion_tokens };
        this.emitUsage( usage, request.metadata );

        return {
            ok       : true,
            text     : choice?.message?.content ?? "",
            finish   : choice?.finish_reason,
            usage,
            model    : this.model,
            provider : this.provider,
        };
    }

    /** Generate image(s) with DALL·E, returned as base64 payloads. */
    override async image( request : Ai.ImageRequest ) : Promise<Ai.ImageResponse>
    {
        this.require( Ai.Capability.IMAGE );
        const key : string = await this.key();
        // the configured image model (config/ai route `model`), else the adapter's image default
        const imageModel : string = this.configuredModel ?? OpenAiAdapter.IMAGE_MODEL;

        const outcome : Attempt<ImageGeneration> = await this.withRetry<ImageGeneration>( async () : Promise<Attempt<ImageGeneration>> =>
        {
            // per-model shaping: dall-e-* need an explicit response_format + have DIFFERENT valid sizes than
            // gpt-image-1 (which REJECTS response_format). Normalize both so any configured model works.
            const isDallE : boolean = imageModel.startsWith( "dall-e" );
            const size : string = OpenAiAdapter.normalizeSize( imageModel, request.size ?? "1024x1024" );
            const quality : string | undefined = OpenAiAdapter.normalizeQuality( imageModel, request.quality );
            const payload : Record<string, unknown> = {
                model  : imageModel,
                prompt : request.prompt,
                n      : request.n ?? 1,
                size,
                ...( quality ? { quality } : {} ),                      // per-model quality knob (see normalizeQuality)
                ...( isDallE ? { response_format: "b64_json" } : {} ),   // gpt-image-1 rejects this; dall-e needs it for b64
            };
            const response : RestfulService.Reply = await this.http.post(
                OpenAiAdapter.IMAGE_PATH,
                null,
                payload,
                { authorization: `Bearer ${key}` },
            );
            return response.ok
                ? { ok: true, value: response.data as ImageGeneration }
                : { ok: false, status: response.status, message: OpenAiAdapter.failureMessage( response, "openai image request failed" ) };
        } );

        if( !outcome.ok )
            return { ok: false, error: { status: outcome.status, message: outcome.message }, images: [], usage: {}, model: imageModel, provider: this.provider };

        const generation : ImageGeneration = outcome.value;
        const images : Array<Ai.ImageOut> = ( generation.data ?? [] ).map( ( item ) => ( { b64: item.b64_json, url: item.url } ) );
        const usage : Ai.Usage = { images: images.length };
        this.emitUsage( usage, request.metadata );

        return { ok: true, images, usage, model: imageModel, provider: this.provider };
    }

    /** Transcribe audio to text + timed segments with Whisper. Uses multipart form-data (an audio file
     *  upload), so this goes through `fetch` (RestfulService is JSON-only); `verbose_json` yields segments. */
    override async transcribe( request : Ai.TranscribeRequest ) : Promise<Ai.TranscribeResponse>
    {
        this.require( Ai.Capability.TRANSCRIBE );
        const key : string = await this.key();
        // the configured transcription model (config/ai route `model`), else the adapter's transcribe default
        const transcribeModel : string = this.configuredModel ?? OpenAiAdapter.TRANSCRIBE_MODEL;

        const outcome : Attempt<WhisperTranscription> = await this.withRetry<WhisperTranscription>( async () : Promise<Attempt<WhisperTranscription>> =>
        {
            try
            {
                const form : FormData = new FormData();
                form.append( "file", new Blob( [ request.audio as unknown as BlobPart ], { type: request.mime } ), `audio.${ OpenAiAdapter.audioExtension( request.mime ) }` );
                form.append( "model", transcribeModel );
                form.append( "response_format", "verbose_json" );   // → text + timed segments
                if( request.language ) form.append( "language", request.language );

                const response : Response = await fetch( `${ OpenAiAdapter.BASE_URL }${ OpenAiAdapter.TRANSCRIBE_PATH }`, {
                    method: "POST", headers: { "Authorization": `Bearer ${ key }` }, body: form,
                } );
                if( !response.ok )
                    return { ok: false, status: response.status, message: `openai transcribe failed: ${ response.status } ${ await response.text().catch( () => "" ) }`.trim() };
                return { ok: true, value: await response.json() as WhisperTranscription };
            }
            catch( error : unknown ) { return { ok: false, message: `openai transcribe error: ${ String( error ) }` }; }
        } );

        if( !outcome.ok )
            return { ok: false, error: { status: outcome.status, message: outcome.message }, text: "", segments: [], usage: {}, model: transcribeModel, provider: this.provider };

        const result : WhisperTranscription = outcome.value;
        const segments : Array<Ai.TranscriptSegment> = ( result.segments ?? [] ).map( ( s ) => ( { start: s.start ?? 0, end: s.end ?? 0, text: ( s.text ?? "" ).trim() } ) );
        const usage : Ai.Usage = {};
        this.emitUsage( usage, request.metadata );

        return { ok: true, text: result.text ?? "", segments, language: result.language, usage, model: transcribeModel, provider: this.provider };
    }

    /** A file extension for the transcription upload, from the audio mime (Whisper keys off the filename). */
    private static audioExtension( mime : string ) : string
    {
        if( mime.includes( "wav" ) ) return "wav";
        if( mime.includes( "mp4" ) || mime.includes( "m4a" ) ) return "m4a";
        if( mime.includes( "webm" ) ) return "webm";
        if( mime.includes( "ogg" ) ) return "ogg";
        return "mp3";
    }
}

/** Internal shape of an OpenAI /v1/audio/transcriptions `verbose_json` response. */
interface WhisperTranscription
{
    text?     : string;
    language? : string;
    segments? : Array<{ start? : number; end? : number; text? : string }>;
}
