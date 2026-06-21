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

    /** One turn in a conversation. */
    export interface Message
    {
        /** Who authored this turn. */
        role    : Role;
        /** The turn's text. */
        content : string;
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
        /** Metering/trace context (not sent to the model). */
        metadata? : RequestMeta;
    }

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
