//
// AiFactory — instantiates AI clients dynamically by Provider, from a registry. New engines are
// added with `register()` (open/closed — no edit here). Keys default to a KMS-backed provider.
//
import { Ai } from "./AiModel";
import type { AdapterOptions } from "./adapters/BaseAdapter";
import { BedrockAdapter } from "./adapters/BedrockAdapter";
import { AnthropicAdapter } from "./adapters/AnthropicAdapter";
import { OpenAiAdapter } from "./adapters/OpenAiAdapter";
import { KmsKeyProvider } from "./KeyProvider";
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
    ] );

    /** Global defaults applied to every {@link AiFactory.create} call (set via {@link AiFactory.configure}). */
    private static config : AiFactory.Config = {};

    /** Set global defaults: default provider, a shared KeyProvider, a usage sink, an account resolver. */
    static configure( config : AiFactory.Config ) : void { AiFactory.config = { ...AiFactory.config, ...config }; }

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

        return make( {
            model       : opts.model,
            keyRef      : opts.keyRef,
            keyProvider,
            region      : opts.region,
            maxAttempts : opts.maxAttempts,
            onUsage     : opts.onUsage ?? AiFactory.config.onUsage,
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
        onUsage?         : AdapterOptions[ "onUsage" ];
        accountConfig?   : ( accountId : string ) => Promise<AccountConfig | undefined>;
    }
}

export default AiFactory;
