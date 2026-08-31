//
// AiFactory — instantiates AI clients dynamically by Provider, from a registry. New engines are
// added with `register()` (open/closed — no edit here). Keys default to a KMS-backed provider.
//
import { Ai } from "./AiModel";
import type { AdapterOptions } from "./adapters/BaseAdapter";
import { BedrockAdapter } from "./adapters/BedrockAdapter";
import { AnthropicAdapter } from "./adapters/AnthropicAdapter";
import { OpenAiAdapter } from "./adapters/OpenAiAdapter";
import { FishAdapter } from "./adapters/FishAdapter";
import { ElevenLabsAdapter } from "./adapters/ElevenLabsAdapter";
import { MagnificAdapter } from "./adapters/MagnificAdapter";
import { GeminiAdapter } from "./adapters/GeminiAdapter";
import { AwsTranscribeAdapter } from "./adapters/AwsTranscribeAdapter";
import { PiperAdapter } from "./adapters/PiperAdapter";
import { PollyAdapter } from "./adapters/PollyAdapter";
import { KmsKeyProvider, SecretsKeyProvider } from "./KeyProvider";
import type { KeyProvider } from "./KeyProvider";

/** Builds an `Ai` client from adapter options — one per provider in the registry. */
export type AdapterFactory = ( opts : AdapterOptions ) => Ai;

export class AiFactory
{
    /** Provider → adapter constructor. Seeded with the built-ins; extend via {@link register}. */
    private static readonly registry : Map<Ai.Provider, AdapterFactory> = new Map<Ai.Provider, AdapterFactory>( [
        [ Ai.Provider.BEDROCK,   ( options ) => new BedrockAdapter( options ) ],
        [ Ai.Provider.ANTHROPIC, ( options ) => new AnthropicAdapter( options ) ],
        [ Ai.Provider.OPENAI,    ( options ) => new OpenAiAdapter( options ) ],
        [ Ai.Provider.FISH,       ( options ) => new FishAdapter( options ) ],
        [ Ai.Provider.ELEVENLABS, ( options ) => new ElevenLabsAdapter( options ) ],
        [ Ai.Provider.MAGNIFIC,   ( options ) => new MagnificAdapter( options ) ],
        [ Ai.Provider.GEMINI,     ( options ) => new GeminiAdapter( options ) ],
        [ Ai.Provider.AWS_TRANSCRIBE, ( options ) => new AwsTranscribeAdapter( options ) ],
        [ Ai.Provider.PIPER,      ( options ) => new PiperAdapter( options ) ],
        [ Ai.Provider.POLLY,      ( options ) => new PollyAdapter( options ) ],
    ] );

    /** Global defaults applied to every {@link AiFactory.create} call (set via {@link AiFactory.configure}). */
    private static config : AiFactory.Config = {};

    /** Set global defaults: default provider, a shared KeyProvider, a usage sink, an account resolver. */
    static configure( config : AiFactory.Config ) : void { AiFactory.config = { ...AiFactory.config, ...config }; }

    /**
     * Wire the platform key source (media-17): resolve every provider's key from Secrets Manager via the
     * ARN the CDK injects as `SECRET_AI_<PROVIDER>`. Called once at service boot (base `Application`) so any
     * service's `AiFactory.create({ provider })` resolves the shared key with no per-call keyRef.
     */
    static usePlatformSecrets( region? : string ) : void
    {
        AiFactory.configure( {
            keyProvider : new SecretsKeyProvider( region ),
            keyRef      : ( provider : Ai.Provider ) => AiFactory.platformKeyRef( provider ),
        } );
    }

    /** The env var name the CDK injects for a provider's platform secret ARN (matches `envVarName(SECRET,
     *  "ai-<provider>")` → `SECRET_AI_<PROVIDER>`); the `SecretsKeyProvider` reads it to find the secret. */
    static platformKeyRef( provider : Ai.Provider ) : string { return `SECRET_AI_${ provider.toUpperCase() }`; }

    /** Register (or replace) an engine adapter — add a new provider without editing the factory. */
    static register( provider : Ai.Provider, make : AdapterFactory ) : void { AiFactory.registry.set( provider, make ); }

    /**
     * Instantiate a client for a provider (default if omitted). The API key is resolved lazily on
     * first call via the configured/explicit KeyProvider (defaults to {@link KmsKeyProvider}).
     */
    static create( opts : AiFactory.CreateOptions = {} ) : Ai
    {
        const provider : Ai.Provider =
            opts.provider ?? AiFactory.config.defaultProvider ?? ( process.env.AI_PROVIDER as Ai.Provider ) ?? Ai.Provider.BEDROCK;

        const make : AdapterFactory | undefined = AiFactory.registry.get( provider );
        if( make === undefined ) throw new Ai.AiError( `no adapter registered for provider '${provider}'`, provider );

        const keyProvider : KeyProvider = opts.keyProvider ?? AiFactory.config.keyProvider ?? new KmsKeyProvider( opts.region );

        // keyRef precedence: explicit → the configured per-provider resolver (platform secrets) → none.
        const keyRef : string | undefined = opts.keyRef ?? AiFactory.config.keyRef?.( provider );

        return make( {
            model            : opts.model,
            keyRef,
            keyProvider,
            region           : opts.region,
            maxAttempts      : opts.maxAttempts,
            videoBucket      : opts.videoBucket,        // Bedrock Nova Reel async output bucket
            transcribeBucket : opts.transcribeBucket,   // Amazon Transcribe audio staging bucket
            piperUrl         : opts.piperUrl,           // self-hosted Piper HTTP server base URL
            onUsage          : opts.onUsage ?? AiFactory.config.onUsage,
        } );
    }

    /**
     * Resolve an account's configured engine (provider / model / BYOK key ref) via the configured
     * `accountConfig` resolver, falling back to the platform default when none is set.
     */
    static async forAccount( accountId : string ) : Promise<Ai>
    {
        const account : AiFactory.AccountConfig | undefined = await AiFactory.config.accountConfig?.( accountId );
        if( account === undefined ) return AiFactory.create();
        return AiFactory.create( { provider: account.provider, model: account.model, keyRef: account.keyRef } );
    }
}

export namespace AiFactory
{
    /** Per-call create options (provider + the adapter knobs). */
    export interface CreateOptions extends AdapterOptions { provider? : Ai.Provider; }

    /** An account's stored AI configuration (engine choice + BYOK key reference). */
    export interface AccountConfig
    {
        provider : Ai.Provider;
        model?   : string;
        keyRef?  : string;          // KMS ciphertext for the account's own key (BYOK)
    }

    /** Global factory configuration. */
    export interface Config
    {
        defaultProvider? : Ai.Provider;
        keyProvider?     : KeyProvider;
        // Default key reference per provider when `create()` gets no explicit `keyRef` — the platform wiring
        // sets this to `platformKeyRef` (the `SECRET_AI_<PROVIDER>` env the CDK injects).
        keyRef?          : ( provider : Ai.Provider ) => string | undefined;
        onUsage?         : AdapterOptions[ "onUsage" ];
        accountConfig?   : ( accountId : string ) => Promise<AccountConfig | undefined>;
    }
}

export default AiFactory;
