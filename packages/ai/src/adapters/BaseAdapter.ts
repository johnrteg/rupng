//
// BaseAdapter — shared machinery for every provider adapter: capability guarding, lazy key
// resolution, retry/backoff, usage emission, and a default `structured` built on `chat`.
// Concrete adapters override only the capabilities they support; the rest throw a clear error.
//
import Ajv, { ValidateFunction } from "ajv";

import { Ai } from "../AiModel";
import type { KeyProvider } from "../KeyProvider";

/** Construction options shared by all adapters (the {@link AiFactory} fills these). */
export interface AdapterOptions
{
    /** Model id to use (else the adapter's default). */
    model?       : string;
    /** Key reference (KMS ciphertext, or env var name) — resolved via {@link AdapterOptions.keyProvider}. */
    keyRef?      : string;
    /** How to turn `keyRef` into a plaintext API key. */
    keyProvider? : KeyProvider;
    /** AWS region (Bedrock / KMS). */
    region?      : string;
    /** S3 bucket for async video output (Bedrock Nova Reel writes the mp4 here; the adapter reads it back). */
    videoBucket? : string;
    /** S3 bucket used to STAGE audio for async speech-to-text (Amazon Transcribe reads its input from S3). */
    transcribeBucket? : string;
    /** Retry attempts on transient failures (default 3). */
    maxAttempts? : number;
    /** Base delay in ms for the exponential back-off between retry attempts (default 200).
     *  Increase for slow provider operations (e.g. image generation) to survive longer transient outages. */
    retryBaseDelayMs? : number;
    /** Sink for per-call usage records (e.g. forward to monitor). */
    onUsage?     : ( usage : Ai.Usage, meta? : Ai.RequestMeta ) => void;
    /** Base URL of a self-hosted Piper HTTP server (`piper --http-server`) — keyless, no Secrets entry. */
    piperUrl?    : string;
}

/**
 * The outcome of one transport attempt — a value, or a (possibly transient) failure. Adapters return
 * this from their {@link BaseAdapter.withRetry} closure so retry decisions inspect a VALUE rather than
 * a thrown error (provider/HTTP failures are not exceptions here).
 */
export type Attempt<T> =
    | { ok : true;  value : T }
    | { ok : false; status? : number; message : string };

/**
 * Abstract base implementing the cross-cutting concerns once for every provider. A concrete adapter
 * declares its `provider` + `capabilities`, overrides the capability methods it supports, and reuses
 * {@link BaseAdapter.key}, {@link BaseAdapter.withRetry}, and {@link BaseAdapter.emitUsage}.
 *
 * **Error policy:** *operational* failures (provider 5xx/429, network, non-JSON output, schema
 * mismatch) are **returned** (`ok:false` on the response / {@link Ai.Result}), never thrown. Only
 * *programmer/config* errors throw — an unsupported {@link Ai.Capability} or a missing API key —
 * since those are bugs to fix, not runtime conditions to handle.
 */
export abstract class BaseAdapter implements Ai
{
    /** The backend this adapter targets. */
    abstract readonly provider     : Ai.Provider;
    /** The capabilities this adapter/model supports — guards every call. */
    abstract readonly capabilities : ReadonlySet<Ai.Capability>;
    /** The resolved model id (from options or the adapter default). */
    readonly model : string;

    /** The adapter options (key, region, retry, usage sink). */
    protected readonly opts : AdapterOptions;
    /** Cached plaintext API key (resolved once, lazily). */
    private _key? : string;

    /** Shared ajv instance for `structured` schema validation. */
    private static readonly ajv : Ajv = new Ajv( { allErrors: true } );

    /**
     * @param opts adapter options (key, region, retry, usage sink).
     * @param defaultModel the model id used when `opts.model` is omitted.
     */
    constructor( opts : AdapterOptions, defaultModel : string )
    {
        this.opts  = opts;
        this.model = opts.model ?? defaultModel;
    }

    // ── capability-guarded defaults — adapters override what they support ──────

    /** Default: chat is unsupported unless an adapter overrides it. */
    chat( _request : Ai.ChatRequest ) : Promise<Ai.ChatResponse> { return this.unsupported( Ai.Capability.CHAT ); }
    /** Default: embed is unsupported unless an adapter overrides it. */
    embed( _request : Ai.EmbedRequest ) : Promise<Ai.EmbedResponse> { return this.unsupported( Ai.Capability.EMBED ); }
    /** Default: image is unsupported unless an adapter overrides it. */
    image( _request : Ai.ImageRequest ) : Promise<Ai.ImageResponse> { return this.unsupported( Ai.Capability.IMAGE ); }
    /** Default: text-to-speech is unsupported unless an adapter overrides it. */
    speak( _request : Ai.SpeakRequest ) : Promise<Ai.SpeakResponse> { return this.unsupported( Ai.Capability.SPEECH ); }
    /** Default: transcription is unsupported unless an adapter overrides it. */
    transcribe( _request : Ai.TranscribeRequest ) : Promise<Ai.TranscribeResponse> { return this.unsupported( Ai.Capability.TRANSCRIBE ); }
    /** Default: sound generation is unsupported unless an adapter overrides it. */
    sound( _request : Ai.SoundRequest ) : Promise<Ai.SoundResponse> { return this.unsupported( Ai.Capability.SOUND ); }
    /** Default: video generation is unsupported unless an adapter overrides it. */
    video( _request : Ai.VideoRequest ) : Promise<Ai.VideoResponse> { return this.unsupported( Ai.Capability.VIDEO ); }
    /** Default: voice cloning is unsupported unless an adapter overrides it. */
    cloneVoice( _request : Ai.CloneVoiceRequest ) : Promise<Ai.CloneVoiceResponse> { return this.unsupported( Ai.Capability.VOICE_CLONE ); }

    /** Default: streaming is unsupported unless an adapter overrides it. */
    // eslint-disable-next-line require-yield
    async * stream( _request : Ai.ChatRequest ) : AsyncIterable<Ai.ChatChunk>
    {
        throw new Ai.UnsupportedCapabilityError( Ai.Capability.STREAM, this.provider );
    }

    /**
     * Default `structured`: instruct the model to emit JSON for `schema`, then **validate** the
     * reply with ajv. Built on `chat`, so any chat-capable adapter that also declares STRUCTURED gets
     * it for free. Adapters with native JSON/tool modes may override.
     *
     * Returns a non-throwing {@link Ai.Result}: a provider failure, a non-JSON reply, or a schema
     * mismatch all come back as `{ ok: false, error }` rather than throwing.
     * @typeParam T the expected (runtime-validated) result shape.
     */
    async structured<T>( request : Ai.StructuredRequest ) : Promise<Ai.Result<T>>
    {
        this.require( Ai.Capability.STRUCTURED );

        const instruction : Ai.Message = {
            role    : Ai.Role.SYSTEM,
            content : `Respond with ONLY a JSON value conforming to this JSON Schema (no prose, no code fences): ${JSON.stringify( request.schema )}`,
        };
        const reply : Ai.ChatResponse = await this.chat( { ...request, messages: [ instruction, ...request.messages ] } );
        if( !reply.ok ) return { ok: false, error: reply.error ?? { message: "structured: chat call failed" } };

        let parsed : unknown;
        try { parsed = JSON.parse( BaseAdapter.extractJson( reply.text ) ); }
        catch( err : unknown ) { return { ok: false, error: { message: "structured: model did not return valid JSON", details: err } }; }

        const validate : ValidateFunction = BaseAdapter.ajv.compile( request.schema as object );
        if( !validate( parsed ) ) return { ok: false, error: { message: "structured: model JSON failed schema validation", details: validate.errors } };

        return { ok: true, value: parsed as T };
    }

    // ── helpers for concrete adapters ────────────────────────────────────────

    /**
     * Throw unless this client supports `capability`. Adapters call this at the top of each method.
     * @throws {@link Ai.UnsupportedCapabilityError}
     */
    protected require( capability : Ai.Capability ) : void
    {
        if( !this.capabilities.has( capability ) ) throw new Ai.UnsupportedCapabilityError( capability, this.provider );
    }

    /**
     * Resolve (and cache) the provider API key from its reference. Runs the {@link KeyProvider}
     * once per client on first use.
     * @throws {@link Ai.AiError} when no key/provider is configured.
     */
    protected async key() : Promise<string>
    {
        if( this._key !== undefined ) return this._key;
        if( this.opts.keyProvider === undefined || this.opts.keyRef === undefined )
            throw new Ai.AiError( `no API key configured for provider '${this.provider}'`, this.provider );
        this._key = await this.opts.keyProvider.resolve( this.opts.keyRef );
        return this._key;
    }

    /**
     * Run `attempt`, retrying **transient** (429 / 5xx) failures with exponential backoff up to
     * `opts.maxAttempts` (default 3). The closure returns an {@link Attempt} (it doesn't throw for
     * provider failures), and so does this — the caller inspects the final outcome. A genuinely
     * thrown error (a real bug) still propagates.
     */
    protected async withRetry<T>( attempt : () => Promise<Attempt<T>> ) : Promise<Attempt<T>>
    {
        const maxAttempts : number = this.opts.maxAttempts ?? 3;
        const baseDelayMs : number = this.opts.retryBaseDelayMs ?? 200;
        let last : Attempt<T> = { ok: false, message: "no attempt made" };
        for( let tries : number = 1; tries <= maxAttempts; tries++ )
        {
            last = await attempt();
            if( last.ok || !BaseAdapter.isTransient( last.status ) || tries === maxAttempts ) return last;
            await BaseAdapter.delay( baseDelayMs * 2 ** ( tries - 1 ) );
        }
        return last;
    }

    /** Emit a usage record to the configured sink (no-op if none configured). */
    protected emitUsage( usage : Ai.Usage, meta? : Ai.RequestMeta ) : void { this.opts.onUsage?.( usage, meta ); }

    /** Build a rejected promise for an unsupported capability. */
    private unsupported<T>( capability : Ai.Capability ) : Promise<T>
    {
        return Promise.reject( new Ai.UnsupportedCapabilityError( capability, this.provider ) );
    }

    /** Heuristic: is this error worth retrying? (HTTP 429 or any 5xx, from `status` or SDK `$metadata`.) */
    /** Is a status worth retrying? (HTTP 429 or any 5xx.) An unknown/undefined status is not retried. */
    private static isTransient( status? : number ) : boolean
    {
        return status === 429 || ( status !== undefined && status >= 500 );
    }

    /** Resolve after `ms` milliseconds (backoff sleep). */
    private static delay( ms : number ) : Promise<void> { return new Promise( ( resolve ) => setTimeout( resolve, ms ) ); }

    /** Pull a JSON value out of a reply that may include code fences / surrounding prose. */
    protected static extractJson( text : string ) : string
    {
        const fenced : RegExpMatchArray | null = text.match( /```(?:json)?\s*([\s\S]*?)```/ );
        if( fenced ) return fenced[ 1 ].trim();
        const first : number = text.indexOf( "{" );
        const last  : number = text.lastIndexOf( "}" );
        return ( first >= 0 && last > first ) ? text.slice( first, last + 1 ) : text.trim();
    }
}
