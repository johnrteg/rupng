//
import { Browse } from "@repo/api";

import { BrowseProvider } from "./BrowseProvider";
import { PexelsAdapter } from "./adapters/PexelsAdapter";
import { UnsplashAdapter } from "./adapters/UnsplashAdapter";
import { SvglAdapter } from "./adapters/SvglAdapter";
import { IconifyAdapter } from "./adapters/IconifyAdapter";

//
// BrowseFactory — the registry of provider adapters (media-13.2), mirroring @repo/ai's AiFactory: a
// `Map<Provider, make>` seeded with the built-ins and extended via `register()`. Adding a provider = register
// an adapter; no call site changes. Key resolution + enablement live in MediaBrowseService (config + secrets).
//
export class BrowseFactory
{
    private readonly registry : Map<Browse.Provider, () => BrowseProvider> = new Map<Browse.Provider, () => BrowseProvider>( [
        [ Browse.Provider.PEXELS,   () => new PexelsAdapter() ],
        [ Browse.Provider.UNSPLASH, () => new UnsplashAdapter() ],
        [ Browse.Provider.SVGL,     () => new SvglAdapter() ],
        [ Browse.Provider.ICONIFY,  () => new IconifyAdapter() ],
        // add more (Pixabay, Artlist, OpenAI, Magnific, ElevenLabs) here as adapters land.
    ] );

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** Register (or replace) an adapter — add a provider without editing call sites. */
    public register( provider : Browse.Provider, make : () => BrowseProvider ) : void { this.registry.set( provider, make ); }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** Instantiate one provider's adapter, or undefined if none is registered. */
    public get( provider : Browse.Provider ) : BrowseProvider | undefined
    {
        const make : ( () => BrowseProvider ) | undefined = this.registry.get( provider );
        return make ? make() : undefined;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** Every registered provider id (for listing/enablement). */
    public providers() : Array<Browse.Provider> { return [ ...this.registry.keys() ]; }
}

export default BrowseFactory;
