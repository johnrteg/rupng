//
import { Browse, BrowseConfig, Media } from "@repo/api";

//
// BrowseProvider — the adapter interface every Browse provider implements (media-13.1). One interface, many
// vendors (stock catalogs + AI generators); concrete adapters map the provider's native API to the normalized
// `Browse.Result`. Selected + instantiated by the BrowseFactory; keys are injected via `BrowseContext`.
//
export interface BrowseProvider
{
    /** Which provider this adapter is. */
    readonly provider : Browse.Provider;

    /** Capabilities, scoped to the kinds root enabled for this provider (media-16.3). */
    info( enabledKinds : Array<Media.Kind> ) : Browse.ProviderInfo;

    /** Normalized search (or, for AI providers, generate-from-prompt) → normalized results. Never throws
     *  through the factory's fan-out — it wraps errors — but adapters should surface provider errors. */
    search( query : Browse.Query, ctx : BrowseContext ) : Promise<Array<Browse.Result>>;

    /** One normalized result by the provider's id (detail view / pre-import). */
    get( externalId : string, ctx : BrowseContext ) : Promise<Browse.Result | null>;

    /** Resolve the licensed bytes for import: either the bytes directly or a URL the service fetches
     *  server-side. `null` when the asset can't be acquired (gone / not licensed / payment needed). */
    acquire( externalId : string, ctx : BrowseContext ) : Promise<BrowseAcquisition | null>;
}

/** Per-call context handed to an adapter — the resolved API key + the active limits. */
export interface BrowseContext
{
    apiKey : string;
    limits : BrowseConfig.Limits;
}

/** What an adapter returns from `acquire` — the normalized result + how to get its bytes. */
export interface BrowseAcquisition
{
    result    : Browse.Result;
    bytes?    : Uint8Array;   // inline bytes (small / already fetched)
    fetchUrl? : string;       // else a URL the import path fetches server-side
}
