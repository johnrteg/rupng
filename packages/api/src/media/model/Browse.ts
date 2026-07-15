//
// Browse — the normalized vocabulary for the media asset marketplace (media-12..17). ONE query shape in, ONE
// result shape out, regardless of which provider(s) answered. Providers (stock catalogs + AI generators) live
// behind a factory in the media service; the UI / Studio only ever see these types. See specs/BROWSE.md.
//
import { Media } from "./Media";

export namespace Browse
{
    /** The configured providers (adapters behind the BrowseFactory). A provider serves 1+ media kinds. */
    export enum Provider
    {
        PEXELS     = "pexels",       // photos + videos (free)
        UNSPLASH   = "unsplash",     // photos (free)
        PIXABAY    = "pixabay",      // images + video + music (free)
        ARTLIST    = "artlist",      // music / sfx / video (licensed / paid)
        OPENAI     = "openai",       // AI image generation (via @repo/ai)
        MAGNIFIC   = "magnific",     // AI image upscale / generate
        ELEVENLABS = "elevenlabs",   // AI audio / voice / sfx generation
        SVGL       = "svgl",         // SVG logos (svgl.app — public, keyless)
        ICONIFY    = "iconify",      // SVG icon sets (iconify.design — public, keyless)
    }

    /** What a provider can do — declared by its adapter, drives fan-out + the UI. */
    export interface ProviderInfo
    {
        provider        : Provider;
        label           : string;                 // display name
        kinds           : Array<Media.Kind>;      // media kinds this provider serves (enabled subset)
        canSearch       : boolean;                // catalog search
        canGenerate     : boolean;                // prompt → asset (AI)
        canDownloadFree : boolean;
        canPurchase     : boolean;
        enabled         : boolean;                // turned on by root config (BrowseConfig)
    }

    /** A normalized search query (one shape for every provider). */
    export interface Query
    {
        text       : string;                      // free-text search (or the generation prompt for AI providers)
        kinds      : Array<Media.Kind>;           // restrict to these media kinds
        providers? : Array<Provider>;             // limit fan-out to these (else all enabled that match `kinds`)
        page?      : number;                      // 1-based page (simple paging)
        cursor?    : string;                      // opaque normalized cursor (encodes each provider's continuation)
        filters?   : Query.Filters;
    }

    export namespace Query
    {
        export interface Filters
        {
            orientation?    : "landscape" | "portrait" | "square";
            minWidth?       : number;
            minDurationSec? : number;
            color?          : string;
            licenseType?    : Media.LicenseType;
            cost?           : "free" | "paid" | "any";
        }
    }

    /** A normalized search result — a provider asset the user can preview then import/purchase. */
    export interface Result
    {
        provider     : Provider;
        externalId   : string;                    // the provider's id for this asset
        kind         : Media.Kind;
        title        : string;
        thumbnailUrl : string;                    // small preview (grid)
        previewUrl?  : string;                    // larger preview (detail)
        downloadUrl? : string;                    // the licensed bytes URL used on import (may be provider-signed)
        width?       : number;
        height?      : number;
        durationSec? : number;                    // video / audio
        author?      : string;
        attribution? : string;                    // credit text (when the license requires it)
        license      : Media.License;
        cost         : Media.Cost;                // free vs priced
        sourceUrl    : string;                    // the asset's page on the provider
        tags         : Array<string>;
    }

    /** Per-provider status in a fan-out response (a slow/failed provider is reported, not fatal). */
    export interface ProviderStatus { provider : Provider; ok : boolean; count : number; error? : string; }
}

export default Browse;
