//
// AI model — the provider-agnostic interface every service/job uses, plus its request/response
// shapes, enums, and errors. See README.md.
//
// `Ai` is BOTH the client interface and a namespace (TS declaration merging): call sites read
//   const reply : Ai.ChatResponse = await ai.chat( { ... } );   // ai : Ai
// while the types live under the same name (Ai.ChatRequest, Ai.Provider, ...).
//
// Scalar primitives come from `Type` in @repo/common (single source of truth).
//
import type { Type } from "@repo/common";

/**
 * A configured AI client bound to one provider + model. Concrete adapters implement this; the
 * {@link AiFactory} builds instances. Every method addresses a capability — calling one the
 * client/model doesn't support throws {@link Ai.UnsupportedCapabilityError}.
 */
export interface Ai
{
    /** The backend serving this client. */
    readonly provider     : Ai.Provider;
    /** The model id in use. */
    readonly model        : string;
    /** What this client/model can actually do — calls to unsupported capabilities throw. */
    readonly capabilities : ReadonlySet<Ai.Capability>;

    ///////////////////////////////////////////////////////////////////////////////////////////////////////
    /**
     * Chat/completion → a text reply. The 80% case.
     * @param request the conversation + generation params.
     * @returns the assistant's reply with usage.
     */
    chat( request : Ai.ChatRequest ) : Promise<Ai.ChatResponse>;

    ///////////////////////////////////////////////////////////////////////////////////////////////////////
    /**
     * Token-streamed chat — for responsive UI / long generations.
     * @param request the conversation + generation params.
     * @returns an async iterable of incremental {@link Ai.ChatChunk}s.
     */
    stream( request : Ai.ChatRequest ) : AsyncIterable<Ai.ChatChunk>;

    ///////////////////////////////////////////////////////////////////////////////////////////////////////
    /**
     * Schema-constrained JSON out — classify / extract / tag. The reply is ajv-validated against
     * `request.schema`, so a successful result is safe to drive logic (e.g. a workflow gate).
     * Returns a non-throwing {@link Ai.Result} — on failure (provider error, non-JSON, or schema
     * mismatch) `ok` is false and `error` is set, rather than throwing.
     * @typeParam T the expected result shape (a runtime-validated assertion, not a compile guarantee).
     * @param request a chat request plus the JSON Schema the output must satisfy.
     */
    structured<T>( request : Ai.StructuredRequest ) : Promise<Ai.Result<T>>;

    ///////////////////////////////////////////////////////////////////////////////////////////////////////
    /**
     * Text → embedding vector(s) — for semantic search / RAG (vectors are stored by the search service).
     * @param request one string or a batch of strings to embed.
     */
    embed( request : Ai.EmbedRequest ) : Promise<Ai.EmbedResponse>;

    ///////////////////////////////////////////////////////////////////////////////////////////////////////
    /**
     * Prompt → generated image(s).
     * @param request the image prompt + count/size.
     */
    image( request : Ai.ImageRequest ) : Promise<Ai.ImageResponse>;

    ///////////////////////////////////////////////////////////////////////////////////////////////////////
    /**
     * Text → spoken audio (text-to-speech). Returns the synthesized audio bytes + mime.
     * @param request the text, optional voice, and output format.
     */
    speak( request : Ai.SpeakRequest ) : Promise<Ai.SpeakResponse>;

    ///////////////////////////////////////////////////////////////////////////////////////////////////////
    /**
     * Audio → text (+ timed segments) — speech-to-text / transcription (e.g. OpenAI Whisper).
     * @param request the audio bytes + mime (± language hint).
     */
    transcribe( request : Ai.TranscribeRequest ) : Promise<Ai.TranscribeResponse>;

    ///////////////////////////////////////////////////////////////////////////////////////////////////////
    /**
     * Prompt → generated sound effect / music (e.g. ElevenLabs sound generation).
     * @param request the sound description + optional duration/format.
     */
    sound( request : Ai.SoundRequest ) : Promise<Ai.SoundResponse>;

    ///////////////////////////////////////////////////////////////////////////////////////////////////////
    /**
     * Prompt → generated video (e.g. Bedrock Nova Reel). May run for minutes; adapters that use an async
     * provider job poll to completion internally and return the finished video bytes.
     * @param request the video description + optional duration/aspect.
     */
    video( request : Ai.VideoRequest ) : Promise<Ai.VideoResponse>;

    ///////////////////////////////////////////////////////////////////////////////////////////////////////
    /**
     * Reference audio → a reusable synthetic voice (voice cloning, e.g. ElevenLabs / fish.audio). Returns the
     * provider voice id, which is account-scoped and later passed to {@link speak} as `voiceId`.
     * @param request the voice name + reference audio sample(s).
     */
    cloneVoice( request : Ai.CloneVoiceRequest ) : Promise<Ai.CloneVoiceResponse>;
}

export namespace Ai
{
    // ── enums ──────────────────────────────────────────────────────────────

    /** A backend that serves models. New backends register an adapter with the factory. */
    export enum Provider
    {
        /** AWS Bedrock — IAM-authed, multi-model (the default). */
        BEDROCK   = "bedrock",
        /** Anthropic direct API (requires an api key). */
        ANTHROPIC = "anthropic",
        /** OpenAI direct API (requires an api key). */
        OPENAI    = "openai",
        /** fish.audio — text-to-speech / voice cloning (requires an api key). */
        FISH      = "fish",
        /** ElevenLabs — text-to-speech / voice cloning / sound effects (requires an api key). */
        ELEVENLABS = "elevenlabs",
        /** Magnific / Freepik — image generation + upscale (requires an api key). */
        MAGNIFIC   = "magnific",
        /** Google Gemini — chat/vision, Imagen image gen, Veo video gen, Gemini TTS (requires an api key). */
        GEMINI     = "gemini",
        /** Amazon Transcribe — speech-to-text (IAM-authed; stages audio through S3, async job). */
        AWS_TRANSCRIBE = "aws-transcribe",
    }

    /** A unit of capability a model/adapter may support. */
    export enum Capability
    {
        /** Text in → text out. */
        CHAT       = "chat",
        /** Text in → schema-validated JSON out. */
        STRUCTURED = "structured",
        /** Text in → embedding vector(s) out. */
        EMBED      = "embed",
        /** Prompt in → image(s) out. */
        IMAGE      = "image",
        /** Incrementally streamed chat tokens. */
        STREAM     = "stream",
        /** Text in → spoken audio out (text-to-speech). */
        SPEECH     = "speech",
        /** Audio in → text (+ timed segments) out (speech-to-text / transcription). */
        TRANSCRIBE = "transcribe",
        /** Prompt in → sound effect / music audio out. */
        SOUND      = "sound",
        /** Prompt (± image) in → video out (generation). */
        VIDEO      = "video",
        /** Reference audio in → a reusable synthetic voice (voice cloning). */
        VOICE_CLONE = "voice_clone",
    }

    /** Conversation roles for a {@link Message}. */
    export enum Role
    {
        /** System / instruction context. */
        SYSTEM    = "system",
        /** The end user / caller turn. */
        USER      = "user",
        /** A model turn (prior assistant reply). */
        ASSISTANT = "assistant",
    }

    // ── messages & requests ──────────────────────────────────────────────────

    /** An image attached to a message (vision input). Provide a `url` OR base64 `b64` (+ `mime`). */
    export interface ImageContent
    {
        url?  : string;
        b64?  : string;
        mime? : string;   // for b64 (e.g. "image/jpeg"); defaults to image/jpeg
    }

    /** One turn in a conversation. */
    export interface Message
    {
        /** Who authored this turn. */
        role    : Role;
        /** The turn's text. */
        content : string;
        /** Optional image inputs (vision) — honored by vision-capable adapters (OpenAI); ignored by others. */
        images? : Array<ImageContent>;
    }

    /** Per-call context for metering/observability — **NOT** sent to the model. */
    export interface RequestMeta
    {
        /** Account the call is attributed to (cost/billing). */
        accountId?     : Type.ID;
        /** Which feature/use-case made the call (cost attribution). */
        feature?       : string;
        /** Transaction id to correlate the call into the request trace (monitor). */
        transactionId? : string;
    }

    /** A chat/completion request. */
    export interface ChatRequest
    {
        /** The conversation so far (may include a leading {@link Role.SYSTEM} turn). */
        messages     : Array<Message>;
        /** Max tokens to generate (adapter applies a sensible default if omitted). */
        maxTokens?   : number;
        /** Sampling temperature (provider default if omitted). */
        temperature? : number;
        /** Stop sequences that halt generation. */
        stop?        : Array<string>;
        /** Metering/trace context (not sent to the model). */
        metadata?    : RequestMeta;
    }

    /** A chat request whose reply must be JSON conforming to `schema` (ajv-validated on return). */
    export interface StructuredRequest extends ChatRequest
    {
        /** JSON Schema the model output must satisfy. */
        schema : Type.JsonObject;
    }

    /** A request to embed one or more texts. */
    export interface EmbedRequest
    {
        /** A single string or a batch to embed (one vector per input). */
        input     : string | Array<string>;
        /** Metering/trace context (not sent to the model). */
        metadata? : RequestMeta;
    }

    /** A request to generate image(s) from a text prompt. */
    export interface ImageRequest
    {
        /** The image description. */
        prompt    : string;
        /** How many images to generate (default 1). */
        n?        : number;
        /** Pixel size, e.g. `"1024x1024"`. */
        size?     : string;
        /** Provider-agnostic quality tier (`low`/`medium`/`high`) — mapped to the provider's native knob. */
        quality?  : string;
        /** Metering/trace context (not sent to the model). */
        metadata? : RequestMeta;
    }

    /** An output audio container/codec for {@link Ai.speak}. */
    export enum AudioFormat
    {
        MP3 = "mp3",
        WAV = "wav",
        PCM = "pcm",
        OPUS = "opus",
    }

    /** A request to synthesize speech from text (text-to-speech). */
    export interface SpeakRequest
    {
        /** The text to speak. */
        text      : string;
        /** Provider voice id / reference (a cloned or preset voice); omit for the provider default. */
        voiceId?  : string;
        /** Desired output format (default {@link AudioFormat.MP3}). */
        format?   : AudioFormat;
        /** Metering/trace context (not sent to the model). */
        metadata? : RequestMeta;
    }

    /** A reference audio sample for {@link Ai.cloneVoice}. */
    export interface VoiceSample { audio : Uint8Array; mime : string; }

    /** A request to clone a voice from reference audio (voice cloning). */
    export interface CloneVoiceRequest
    {
        /** A display name for the cloned voice. */
        name        : string;
        /** One or more reference audio samples of the target voice. */
        samples     : Array<VoiceSample>;
        /** Optional description / labels. */
        description? : string;
        /** Metering/trace context (not sent to the model). */
        metadata?   : RequestMeta;
    }

    /** The result of an {@link Ai.cloneVoice} call — the provider's reusable voice id (for later `speak`). */
    export interface CloneVoiceResponse
    {
        ok       : boolean;
        error?   : Failure;
        /** The provider voice id — plug into {@link SpeakRequest.voiceId} to speak in this voice. */
        voiceId  : string;
        name     : string;
        provider : Provider;
    }

    /** A request to generate a video from a text prompt. */
    export interface VideoRequest
    {
        /** The video description. */
        prompt      : string;
        /** Desired length in seconds (provider default if omitted). */
        durationSec? : number;
        /** Aspect ratio hint (e.g. `"16:9"`). */
        aspect?     : string;
        /** Metering/trace context (not sent to the model). */
        metadata?   : RequestMeta;
    }

    /** A request to generate a sound effect / music clip from a text prompt. */
    export interface SoundRequest
    {
        /** The sound description. */
        prompt      : string;
        /** Desired length in seconds (provider default if omitted). */
        durationSec? : number;
        /** Desired output format (default {@link AudioFormat.MP3}). */
        format?     : AudioFormat;
        /** Metering/trace context (not sent to the model). */
        metadata?   : RequestMeta;
    }

    /** A request to transcribe audio to text (speech-to-text). */
    export interface TranscribeRequest
    {
        /** The audio bytes to transcribe. */
        audio     : Uint8Array;
        /** The audio mime type (e.g. `"audio/mpeg"`) — drives the upload filename/extension. */
        mime      : string;
        /** BCP-47 language hint (e.g. `"en"`); omit to auto-detect. */
        language? : string;
        /** Metering/trace context (not sent to the model). */
        metadata? : RequestMeta;
    }

    /** One timed segment of a transcript — `start`/`end` are seconds offsets into the audio. */
    export interface TranscriptSegment { start : number; end : number; text : string; }

    // ── responses ─────────────────────────────────────────────────────────────

    /** Describes a non-throwing operational failure (provider error, bad output, …). */
    export interface Failure
    {
        /** Human-readable summary. */
        message  : string;
        /** HTTP-ish status when the failure came from a provider call. */
        status?  : number;
        /** Optional machine-readable code. */
        code?    : string;
        /** Optional detail (e.g. ajv validation errors). */
        details? : unknown;
    }

    /**
     * The result of a {@link Ai.chat} call. Operational failures are returned, **not thrown** —
     * check `ok` (on failure `text` is empty and `error` is set).
     */
    export interface ChatResponse
    {
        /** True on success; false when the call failed operationally (see `error`). */
        ok       : boolean;
        /** Set when `ok` is false. */
        error?   : Failure;
        /** The assistant's reply text (empty on failure). */
        text     : string;
        /** Provider stop reason (e.g. `"end_turn"`, `"max_tokens"`), if given. */
        finish?  : string;
        /** Token usage for the call. */
        usage    : Usage;
        /** The model that produced the reply. */
        model    : string;
        /** The provider that served the call. */
        provider : Provider;
    }

    /** One incremental piece of a {@link Ai.stream}. */
    export interface ChatChunk
    {
        /** The text delta since the previous chunk. */
        delta : string;
        /** True on the final chunk. */
        done  : boolean;
    }

    /** The result of an {@link Ai.embed} call. Failures are returned (`ok:false`), not thrown. */
    export interface EmbedResponse
    {
        /** True on success; false when the call failed operationally (see `error`). */
        ok       : boolean;
        /** Set when `ok` is false. */
        error?   : Failure;
        /** One embedding vector per input, in input order (empty on failure). */
        vectors  : Array<Array<number>>;
        /** Token usage for the call. */
        usage    : Usage;
        /** The embedding model used. */
        model    : string;
        /** The provider that served the call. */
        provider : Provider;
    }

    /** A single generated image — base64 payload and/or a URL, per provider. */
    export interface ImageOut
    {
        /** Base64-encoded image bytes (when requested as b64). */
        b64? : string;
        /** A URL to the generated image (when the provider returns one). */
        url? : string;
    }

    /** The result of an {@link Ai.image} call. Failures are returned (`ok:false`), not thrown. */
    export interface ImageResponse
    {
        /** True on success; false when the call failed operationally (see `error`). */
        ok       : boolean;
        /** Set when `ok` is false. */
        error?   : Failure;
        /** The generated image(s) (empty on failure). */
        images   : Array<ImageOut>;
        /** Usage (image count) for the call. */
        usage    : Usage;
        /** The image model used. */
        model    : string;
        /** The provider that served the call. */
        provider : Provider;
    }

    /** The result of an {@link Ai.transcribe} call. Failures are returned (`ok:false`), not thrown. */
    export interface TranscribeResponse
    {
        /** True on success; false when the call failed operationally (see `error`). */
        ok       : boolean;
        /** Set when `ok` is false. */
        error?   : Failure;
        /** The full transcript text (empty on failure). */
        text     : string;
        /** Timed segments (start/end seconds) — empty if the provider didn't return timestamps. */
        segments : Array<TranscriptSegment>;
        /** Detected/echoed language (BCP-47), if given. */
        language? : string;
        /** Token/second usage for the call. */
        usage    : Usage;
        /** The transcription model used. */
        model    : string;
        /** The provider that served the call. */
        provider : Provider;
    }

    /** The result of an {@link Ai.video} call — generated video bytes. Failures are returned (`ok:false`). */
    export interface VideoResponse
    {
        /** True on success; false when the call failed operationally (see `error`). */
        ok       : boolean;
        /** Set when `ok` is false. */
        error?   : Failure;
        /** The generated video bytes (empty on failure). */
        video    : Uint8Array;
        /** The video mime type (e.g. `"video/mp4"`). */
        mime     : string;
        /** Usage for the call. */
        usage    : Usage;
        /** The model used. */
        model    : string;
        /** The provider that served the call. */
        provider : Provider;
    }

    /** The result of an {@link Ai.sound} call — generated sound-effect / music audio. Failures returned. */
    export interface SoundResponse
    {
        /** True on success; false when the call failed operationally (see `error`). */
        ok       : boolean;
        /** Set when `ok` is false. */
        error?   : Failure;
        /** The generated audio bytes (empty on failure). */
        audio    : Uint8Array;
        /** The audio mime type. */
        mime     : string;
        /** The audio format produced. */
        format   : AudioFormat;
        /** Usage for the call. */
        usage    : Usage;
        /** The model used. */
        model    : string;
        /** The provider that served the call. */
        provider : Provider;
    }

    /** The result of an {@link Ai.speak} call. Failures are returned (`ok:false`), not thrown. */
    export interface SpeakResponse
    {
        /** True on success; false when the call failed operationally (see `error`). */
        ok       : boolean;
        /** Set when `ok` is false. */
        error?   : Failure;
        /** The synthesized audio bytes (empty on failure). */
        audio    : Uint8Array;
        /** The audio mime type (e.g. `"audio/mpeg"`). */
        mime     : string;
        /** The audio format produced. */
        format   : AudioFormat;
        /** Usage for the call (provider-specific; often character count in `inputTokens`). */
        usage    : Usage;
        /** The speech model used. */
        model    : string;
        /** The provider that served the call. */
        provider : Provider;
    }

    /** Token/image counts + optional cost estimate, emitted per call for metering (monitor/analytics). */
    export interface Usage
    {
        /** Prompt/input tokens consumed. */
        inputTokens?  : number;
        /** Completion/output tokens produced. */
        outputTokens? : number;
        /** Number of images produced (image calls). */
        images?       : number;
        /** Optional $ estimate (provider pricing applied downstream). */
        costEstimate? : number;
    }

    /**
     * A non-throwing result for {@link Ai.structured}: either the validated value, or a {@link Failure}
     * (provider error, non-JSON reply, or schema-validation failure). Narrow on `ok`.
     */
    export type Result<T> =
        | { ok : true;  value : T }
        | { ok : false; error : Failure };

    // ── errors ─────────────────────────────────────────────────────────────────

    /** Base class for all errors thrown by `@repo/ai`. */
    export class AiError extends Error
    {
        /**
         * @param message human-readable error.
         * @param provider the provider involved, when known.
         */
        constructor( message : string, readonly provider? : Provider )
        {
            super( message );
            this.name = "AiError";
        }
    }

    /** Thrown when a capability is requested of a provider/model that doesn't support it. */
    export class UnsupportedCapabilityError extends AiError
    {
        /**
         * @param capability the unsupported capability.
         * @param provider the provider that lacks it.
         */
        constructor( capability : Capability, provider : Provider )
        {
            super( `capability '${capability}' not supported by provider '${provider}'`, provider );
            this.name = "UnsupportedCapabilityError";
        }
    }

}

export default Ai;
