//
// OAuthFactory — resolves the right {@link OAuthBroker} for a provider. HYBRID: a provider with a
// hand-built **native** adapter (registered via {@link registerNative}) uses it; everything else falls
// back to the shared **Nango** broker (the long tail). Build the native few, delegate the rest — one
// interface, callers don't care which.
//
import { OAuthBroker, OAuth } from "./OAuthBroker";
import { NangoBroker } from "./adapters/NangoBroker";

export class OAuthFactory
{
    /** Global defaults (Nango host/secretKey) applied to the fallback broker. */
    private static config : OAuth.Config = {};

    /** Lazily-built shared Nango broker (the long-tail fallback). */
    private static nango? : NangoBroker;

    /** provider → native adapter (the high-value few). Empty until a native adapter is built + registered. */
    private static readonly native : Map<string, OAuthBroker> = new Map<string, OAuthBroker>();

    /** Set global defaults for the fallback Nango broker (host + secretKey). */
    static configure( config : OAuth.Config ) : void { OAuthFactory.config = { ...OAuthFactory.config, ...config }; }

    /** Register a hand-built **native** broker for a provider — it then wins over Nango for that provider. */
    static registerNative( provider : string, broker : OAuthBroker ) : void { OAuthFactory.native.set( provider, broker ); }

    /**
     * The broker to use for `provider`: its native adapter if one is registered, else the shared Nango
     * broker (built once from {@link configure}/env on first use).
     */
    static for( provider : string ) : OAuthBroker
    {
        const native : OAuthBroker | undefined = OAuthFactory.native.get( provider );
        if( native !== undefined ) return native;
        return OAuthFactory.nango ??= new NangoBroker( OAuthFactory.config );
    }
}

export default OAuthFactory;
