//
// AiRouting — the platform's non-secret AI routing policy (each service's AppConfig `config/ai` profile):
// which provider (and optional model) handles each AI *modality* (chat, image, text-to-speech, …). Every
// service runs the AiFactory, so this is a SHARED, reusable config model (mirrors the Browse.Provider
// pattern: @repo/api owns the provider *vocabulary*; @repo/ai owns the adapter *registry*). Provider API
// KEYS are NOT here — they're the platform-shared Secrets Manager entries (`ai-<provider>`), resolved by
// @repo/ai's SecretsKeyProvider. Lives in @repo/api (one definition) so services seed `DEFAULT` and the
// Console lints against `SCHEMA`.
//
import { Validation } from "../../model/Validation";

export namespace AiRouting
{
    /** An AI modality (a "media type" of AI work) a service can route to a provider. Extensible — add
     *  members as new modalities ship; a route for an unknown modality is simply ignored by older code. */
    export enum Modality
    {
        CHAT           = "chat",             // text (± vision images) in → text / structured out
        IMAGE          = "image",            // prompt → image(s) (generation)
        VIDEO          = "video",            // prompt / image → video (generation)
        TEXT_TO_SPEECH = "text_to_speech",   // text → spoken audio (voice)
        SPEECH_TO_TEXT = "speech_to_text",   // audio → transcript
        SPEECH_CLONING = "speech_cloning",   // reference audio → a reusable synthetic voice
        SOUND          = "sound",            // prompt → sound effects / music (generation)
    }

    /** Availability scope of an AI capability. `PLATFORM` = shared across all accounts (one platform key,
     *  shareable artifacts). `ACCOUNT` = confined to a single account — its own key and/or **private
     *  artifacts** that must never be usable by another account (e.g. a cloned voice). */
    export enum Scope
    {
        PLATFORM = "platform",
        ACCOUNT  = "account",
    }

    /** Modalities whose ARTIFACTS are inherently account-private and can never be platform-shared, regardless
     *  of config — a route for one of these is forced to {@link Scope.ACCOUNT}. Speech cloning produces a
     *  voice owned by one account; exposing it platform-wide would leak that voice to other accounts. */
    export const ACCOUNT_ONLY_MODALITIES : ReadonlySet<Modality> = new Set<Modality>( [ Modality.SPEECH_CLONING ] );

    /** The default (and MINIMUM) scope for a modality — account-only modalities can't be widened to platform. */
    export function defaultScope( modality : Modality ) : Scope
    {
        return ACCOUNT_ONLY_MODALITIES.has( modality ) ? Scope.ACCOUNT : Scope.PLATFORM;
    }

    /** The AI provider vocabulary (config-level). The subset that has a registered @repo/ai adapter is what
     *  `AiFactory.create` can actually instantiate; the rest are namable in config ahead of their adapter. */
    export enum Provider
    {
        OPENAI     = "openai",
        ANTHROPIC  = "anthropic",
        BEDROCK    = "bedrock",
        ELEVENLABS = "elevenlabs",   // text-to-speech / speech cloning
        FISH       = "fish",         // fish.audio — text-to-speech / speech cloning
        MAGNIFIC   = "magnific",     // image generation / upscale
        GEMINI     = "gemini",       // Google Gemini — chat/vision, Imagen (image), Veo (video), Gemini TTS
        AWS_TRANSCRIBE = "aws-transcribe",   // Amazon Transcribe — speech-to-text (IAM; S3-staged async job)
    }

    /** What an AI provider can do — the modalities it supports + a display label. Drives the AI Gen UI's
     *  per-modality provider pickers and validates that a `config/ai` route pairs a provider with a modality
     *  it actually supports. A provider with no @repo/ai adapter yet is still listed (namable ahead of it). */
    /** How many solutions a provider can return from one prompt for a media type — normalized so the UI can
     *  offer a bounded "how many to generate" control. `default` is the pre-filled count. */
    export interface CandidateRange { min : number; max : number; default : number; }

    /** The fallback when a provider/modality declares no range — a single solution. */
    export const SINGLE_CANDIDATE : CandidateRange = { min: 1, max: 1, default: 1 };

    export interface ProviderInfo
    {
        provider    : Provider;
        label       : string;
        modalities  : Array<Modality>;
        // How many candidate solutions the provider returns from a prompt, BY media type (media-18.1). Absent
        // → a single solution ({@link SINGLE_CANDIDATE}). e.g. image providers can return several variations.
        candidates? : Partial<Record<Modality, CandidateRange>>;
        // The provider itself is only usable per-account (e.g. BYOK-only / account-private tenancy) — every
        // route to it resolves to {@link Scope.ACCOUNT} regardless of modality. Omit/false = platform-capable.
        accountOnly? : boolean;
    }

    /** The catalog of AI providers and the media types (modalities) each supports (media-17). Single source
     *  for the UI provider pickers + route validation — it reflects each provider's PUBLIC API surface (what
     *  the provider CAN do), not what the @repo/ai adapter implements yet. The generate flow gates on the
     *  instantiated client's actual `Ai.capabilities`, so a catalogued-but-unimplemented modality resolves to
     *  "unavailable" rather than a broken call. Adapters land incrementally (chat first).
     *
     *  AWS Bedrock is a first-class provider (the AiFactory default): text via Claude/Llama/Titan/Mistral,
     *  image via Titan Image / SDXL / Nova Canvas, video via Nova Reel. Note: TTS/STT on AWS are **Amazon
     *  Polly / Transcribe** (separate services), NOT Bedrock — add them as their own providers if wanted. On
     *  LocalStack Bedrock is API-only (the call path works; real generation runs against real AWS). */
    export const CATALOG : Array<ProviderInfo> =
    [
        { provider: Provider.OPENAI,     label: "OpenAI",      modalities: [ Modality.CHAT, Modality.IMAGE, Modality.TEXT_TO_SPEECH, Modality.SPEECH_TO_TEXT ],
          candidates: { [ Modality.IMAGE ]: { min: 1, max: 4, default: 1 } } },
        { provider: Provider.ANTHROPIC,  label: "Anthropic",   modalities: [ Modality.CHAT ] },
        { provider: Provider.BEDROCK,    label: "AWS Bedrock", modalities: [ Modality.CHAT, Modality.IMAGE, Modality.VIDEO ],
          candidates: { [ Modality.IMAGE ]: { min: 1, max: 4, default: 1 } } },
        { provider: Provider.ELEVENLABS, label: "ElevenLabs",  modalities: [ Modality.TEXT_TO_SPEECH, Modality.SPEECH_CLONING, Modality.SOUND, Modality.SPEECH_TO_TEXT ] },
        { provider: Provider.FISH,       label: "fish.audio",  modalities: [ Modality.TEXT_TO_SPEECH, Modality.SPEECH_CLONING, Modality.SOUND ] },
        { provider: Provider.MAGNIFIC,   label: "Magnific",    modalities: [ Modality.IMAGE ],
          candidates: { [ Modality.IMAGE ]: { min: 1, max: 4, default: 2 } } },
        { provider: Provider.GEMINI,     label: "Google Gemini", modalities: [ Modality.CHAT, Modality.IMAGE, Modality.VIDEO, Modality.TEXT_TO_SPEECH, Modality.SPEECH_TO_TEXT ],
          candidates: { [ Modality.IMAGE ]: { min: 1, max: 4, default: 1 } } },
        { provider: Provider.AWS_TRANSCRIBE, label: "Amazon Transcribe", modalities: [ Modality.SPEECH_TO_TEXT ] },
    ];

    /** The providers that can serve a modality (for a UI provider picker / route validation). */
    export function providersFor( modality : Modality ) : Array<ProviderInfo>
    {
        return CATALOG.filter( ( info ) => info.modalities.includes( modality ) );
    }

    /** Does `provider` support `modality`? (guards a `config/ai` route before it's applied.) */
    export function supports( provider : Provider, modality : Modality ) : boolean
    {
        return CATALOG.some( ( info ) => info.provider === provider && info.modalities.includes( modality ) );
    }

    /** The catalog entry for a provider (or undefined if not catalogued). */
    export function providerInfo( provider : Provider ) : ProviderInfo | undefined
    {
        return CATALOG.find( ( info ) => info.provider === provider );
    }

    //
    // Per-(provider, modality) DEFAULT MODEL — the model the backend uses for a modality when the caller
    // doesn't pin one. This is the single place the platform "picks the model" (each modality needs a
    // DIFFERENT model — e.g. Gemini chat = gemini-2.5-flash but image = imagen-4.0, video = veo-3.1 — so the
    // chat default must NOT leak into image/video/tts). A per-account / marketplace-provided model overrides
    // this (passed as the request/route `model`). Absent → the adapter's own built-in default for that modality.
    //
    export const MODELS : Partial<Record<Provider, Partial<Record<Modality, string>>>> =
    {
        [ Provider.OPENAI ]: {
            [ Modality.CHAT ]:           "gpt-4o-mini",
            [ Modality.IMAGE ]:          "gpt-image-1",
            [ Modality.SPEECH_TO_TEXT ]: "whisper-1",
        },
        [ Provider.GEMINI ]: {
            [ Modality.CHAT ]:           "gemini-2.5-flash",
            [ Modality.IMAGE ]:          "gemini-2.5-flash-image",   // native image gen (:generateContent) — FREE tier; Imagen (:predict) is paid-only
            [ Modality.VIDEO ]:          "veo-3.1-generate-preview",
            [ Modality.TEXT_TO_SPEECH ]: "gemini-2.5-flash-preview-tts",
            [ Modality.SPEECH_TO_TEXT ]: "gemini-2.5-flash",
        },
        [ Provider.ANTHROPIC ]: {
            [ Modality.CHAT ]: "claude-3-5-sonnet-latest",
        },
        [ Provider.BEDROCK ]: {
            [ Modality.CHAT ]:  "anthropic.claude-3-5-sonnet-20240620-v1:0",
            [ Modality.IMAGE ]: "amazon.titan-image-generator-v1",
            [ Modality.VIDEO ]: "amazon.nova-reel-v1:0",
        },
        [ Provider.ELEVENLABS ]: {
            [ Modality.TEXT_TO_SPEECH ]: "eleven_multilingual_v2",
            [ Modality.SPEECH_TO_TEXT ]: "scribe_v1",   // ElevenLabs Scribe speech-to-text
        },
        [ Provider.FISH ]: {
            [ Modality.TEXT_TO_SPEECH ]: "speech-1.6",
        },
        [ Provider.MAGNIFIC ]: {
            [ Modality.IMAGE ]: "mystic",
        },
    };

    /** The default model for a (provider, modality) pair, or undefined (→ the adapter's own modality default). */
    export function modelFor( provider : Provider, modality : Modality ) : string | undefined
    {
        return MODELS[ provider ]?.[ modality ];
    }

    /** How many solutions a provider returns for a media type — the configured range or a single solution. */
    export function candidatesFor( provider : Provider, modality : Modality ) : CandidateRange
    {
        return providerInfo( provider )?.candidates?.[ modality ] ?? SINGLE_CANDIDATE;
    }

    /** The candidate range for a modality across a set of providers (min-of-mins, max-of-maxes) — for a UI
     *  count control before a specific provider is chosen (e.g. "Auto"). Single when none offer multiples. */
    export function candidateRangeFor( modality : Modality, providers : Array<Provider> ) : CandidateRange
    {
        const ranges : Array<CandidateRange> = providers.map( ( provider ) => candidatesFor( provider, modality ) );
        if( ranges.length === 0 ) return SINGLE_CANDIDATE;
        return {
            min:     Math.min( ...ranges.map( ( r ) => r.min ) ),
            max:     Math.max( ...ranges.map( ( r ) => r.max ) ),
            default: Math.max( ...ranges.map( ( r ) => r.default ) ),
        };
    }

    /** The effective scope for a resolved route: `ACCOUNT` if the modality is account-only OR the provider is
     *  account-only OR the route opts into account scope; otherwise the route's scope (default `PLATFORM`).
     *  An account-only modality/provider can NEVER be widened to platform — the floor always wins. */
    export function effectiveScope( provider : Provider, modality : Modality, route? : Route ) : Scope
    {
        if( ACCOUNT_ONLY_MODALITIES.has( modality ) ) return Scope.ACCOUNT;
        if( providerInfo( provider )?.accountOnly )    return Scope.ACCOUNT;
        return route?.scope ?? Scope.PLATFORM;
    }

    /** The provider (and optional pinned model) chosen for one modality. */
    export interface Route
    {
        provider : Provider;
        model?   : string;      // provider-specific model id; omit to use the adapter's default
        // Availability of this route. Advisory for platform-capable modalities; account-only modalities
        // ({@link ACCOUNT_ONLY_MODALITIES}) and account-only providers are forced to ACCOUNT — see
        // {@link effectiveScope}. Omit to use {@link defaultScope} for the modality.
        scope?   : Scope;
    }

    /** The routing table: modality → chosen provider/model. Partial — an unset modality has no route (the
     *  caller treats it as "no provider configured" and degrades gracefully). */
    export interface Config
    {
        routes : Partial<Record<Modality, Route>>;
    }

    // ── Schema + validator (shared: service / web / Console) ─────────────────────────────────────
    export const SCHEMA : Validation.Schema =
    {
        $schema: "http://json-schema.org/draft-07/schema#",
        type: "object", additionalProperties: false,
        required: [ "routes" ],
        properties:
        {
            routes:
            {
                type: "object", additionalProperties: false,
                properties: Object.fromEntries( Object.values( Modality ).map( ( modality ) => [ modality, {
                    type: "object", additionalProperties: false,
                    required: [ "provider" ],
                    properties: {
                        provider: { type: "string", enum: Object.values( Provider ) },
                        model:    { type: "string" },
                        scope:    { type: "string", enum: Object.values( Scope ) },
                    },
                } ] ) ),
            },
        },
    };

    /** JSON Schema validator for `Config`. */
    export const validate : Validation.Validator<Config> = Validation.compile<Config>( SCHEMA );

    // ── Seeded defaults (what a service seeds + falls back to) ────────────────────────────────────
    // OpenAI handles the text/vision/image modalities out of the box (it's the provider with an adapter +
    // a platform key today); fish.audio is the intended default for the speech modalities. A modality whose
    // provider has no registered @repo/ai adapter yet simply resolves to "unavailable" until it lands. Video
    // is left unset until a provider is configured.
    export const DEFAULT : Config =
    {
        routes:
        {
            [ Modality.CHAT ]:           { provider: Provider.OPENAI, model: "gpt-4o-mini" },
            [ Modality.IMAGE ]:          { provider: Provider.OPENAI, model: "gpt-image-1" },
            [ Modality.SPEECH_TO_TEXT ]: { provider: Provider.OPENAI, model: "whisper-1" },
            [ Modality.VIDEO ]:          { provider: Provider.BEDROCK },   // Nova Reel (async, media-video path)
            [ Modality.TEXT_TO_SPEECH ]: { provider: Provider.FISH },
            [ Modality.SPEECH_CLONING ]: { provider: Provider.FISH },
        },
    };
}

export default AiRouting;
