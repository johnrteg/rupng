import { Account } from "@repo/api";

//
// GoogleFonts — a curated catalog of popular Google Font families plus helpers to (a) build the PUBLIC stylesheet
// URL a brand font is stored + rendered from, and (b) inject a stylesheet so families preview live in the picker.
// Google's CDN is public + CORS-permissive + non-expiring, so a stored `href` renders everywhere the brand does
// (image editor, exports, email recipients) — no hosting/licensing burden. The list is curated (the full catalog
// needs the Google Fonts API + a key); it can grow over time.
//

/** Google's font CATEGORIES (the same axis the Google Fonts API + website filter by). Closed set → enum. */
export enum FontCategory
{
    SANS        = "sans-serif",
    SERIF       = "serif",
    DISPLAY     = "display",
    HANDWRITING = "handwriting",
    MONOSPACE   = "monospace",
}

/** The category filter order for the picker. */
export const FONT_CATEGORIES : Array<FontCategory> = Object.values( FontCategory );

/** A catalog entry — a family + its Google category (for filtering). */
export interface FontEntry
{
    family   : string;
    category : FontCategory;
}

/** Curated Google Font families offered in the picker (a broad popular set across categories). The FULL catalog
 *  (~1800) + live categories comes from the Google Fonts Developer API — a follow-up that needs an API key. */
export const GOOGLE_FONTS : Array<FontEntry> =
[
    // ── sans-serif ──
    { family: "Roboto", category: FontCategory.SANS }, { family: "Open Sans", category: FontCategory.SANS },
    { family: "Lato", category: FontCategory.SANS }, { family: "Montserrat", category: FontCategory.SANS },
    { family: "Poppins", category: FontCategory.SANS }, { family: "Inter", category: FontCategory.SANS },
    { family: "Raleway", category: FontCategory.SANS }, { family: "Nunito", category: FontCategory.SANS },
    { family: "Work Sans", category: FontCategory.SANS }, { family: "Rubik", category: FontCategory.SANS },
    { family: "Noto Sans", category: FontCategory.SANS }, { family: "Source Sans 3", category: FontCategory.SANS },
    { family: "Mulish", category: FontCategory.SANS }, { family: "Manrope", category: FontCategory.SANS },
    { family: "DM Sans", category: FontCategory.SANS }, { family: "Fira Sans", category: FontCategory.SANS },
    { family: "Karla", category: FontCategory.SANS }, { family: "Barlow", category: FontCategory.SANS },
    { family: "Cabin", category: FontCategory.SANS }, { family: "PT Sans", category: FontCategory.SANS },
    { family: "Ubuntu", category: FontCategory.SANS }, { family: "Quicksand", category: FontCategory.SANS },
    { family: "Josefin Sans", category: FontCategory.SANS }, { family: "Archivo", category: FontCategory.SANS },
    { family: "Space Grotesk", category: FontCategory.SANS }, { family: "Titillium Web", category: FontCategory.SANS },
    { family: "Assistant", category: FontCategory.SANS }, { family: "Heebo", category: FontCategory.SANS },
    { family: "Libre Franklin", category: FontCategory.SANS }, { family: "Red Hat Display", category: FontCategory.SANS },
    { family: "Sora", category: FontCategory.SANS }, { family: "Figtree", category: FontCategory.SANS },
    { family: "Jost", category: FontCategory.SANS }, { family: "Signika", category: FontCategory.SANS },
    // ── serif ──
    { family: "Merriweather", category: FontCategory.SERIF }, { family: "Playfair Display", category: FontCategory.SERIF },
    { family: "Roboto Slab", category: FontCategory.SERIF }, { family: "Libre Baskerville", category: FontCategory.SERIF },
    { family: "Cormorant Garamond", category: FontCategory.SERIF }, { family: "Crimson Text", category: FontCategory.SERIF },
    { family: "EB Garamond", category: FontCategory.SERIF }, { family: "Zilla Slab", category: FontCategory.SERIF },
    { family: "Lora", category: FontCategory.SERIF }, { family: "PT Serif", category: FontCategory.SERIF },
    { family: "Noto Serif", category: FontCategory.SERIF }, { family: "Bitter", category: FontCategory.SERIF },
    { family: "Spectral", category: FontCategory.SERIF }, { family: "Domine", category: FontCategory.SERIF },
    { family: "Vollkorn", category: FontCategory.SERIF }, { family: "Cardo", category: FontCategory.SERIF },
    // ── display ──
    { family: "Bebas Neue", category: FontCategory.DISPLAY }, { family: "Anton", category: FontCategory.DISPLAY },
    { family: "Abril Fatface", category: FontCategory.DISPLAY }, { family: "Teko", category: FontCategory.DISPLAY },
    { family: "Righteous", category: FontCategory.DISPLAY }, { family: "Fjalla One", category: FontCategory.DISPLAY },
    { family: "Alfa Slab One", category: FontCategory.DISPLAY }, { family: "Staatliches", category: FontCategory.DISPLAY },
    { family: "Archivo Black", category: FontCategory.DISPLAY }, { family: "Oswald", category: FontCategory.DISPLAY },
    // ── handwriting ──
    { family: "Dancing Script", category: FontCategory.HANDWRITING }, { family: "Pacifico", category: FontCategory.HANDWRITING },
    { family: "Lobster", category: FontCategory.HANDWRITING }, { family: "Caveat", category: FontCategory.HANDWRITING },
    { family: "Satisfy", category: FontCategory.HANDWRITING }, { family: "Great Vibes", category: FontCategory.HANDWRITING },
    { family: "Sacramento", category: FontCategory.HANDWRITING }, { family: "Shadows Into Light", category: FontCategory.HANDWRITING },
    { family: "Indie Flower", category: FontCategory.HANDWRITING }, { family: "Permanent Marker", category: FontCategory.HANDWRITING },
    { family: "Kalam", category: FontCategory.HANDWRITING },
    // ── monospace ──
    { family: "Roboto Mono", category: FontCategory.MONOSPACE }, { family: "Source Code Pro", category: FontCategory.MONOSPACE },
    { family: "JetBrains Mono", category: FontCategory.MONOSPACE }, { family: "Fira Code", category: FontCategory.MONOSPACE },
    { family: "Space Mono", category: FontCategory.MONOSPACE }, { family: "IBM Plex Mono", category: FontCategory.MONOSPACE },
    { family: "Inconsolata", category: FontCategory.MONOSPACE }, { family: "Ubuntu Mono", category: FontCategory.MONOSPACE },
];

////////////////////////////////////////////////////////////////////////////////////////////
/** The public CSS URL for ONE family — stored as a brand font's `href` (renders anywhere). */
export function googleFontHref( family : string ) : string
{
    const encoded : string = family.replace( / /g, "+" );
    return `https://fonts.googleapis.com/css2?family=${ encoded }&display=swap`;
}

////////////////////////////////////////////////////////////////////////////////////////////
/** ONE stylesheet URL loading MANY families at once — used to preview the whole catalog in the picker. */
export function googleFontsHref( families : Array<string> ) : string
{
    const parts : Array<string> = families.map( ( family : string ) : string => `family=${ family.replace( / /g, "+" ) }` );
    return `https://fonts.googleapis.com/css2?${ parts.join( "&" ) }&display=swap`;
}

////////////////////////////////////////////////////////////////////////////////////////////
/** A `BrandFont` reference (name + public href) for a Google family. */
export function toBrandFont( family : string ) : Account.BrandFont
{
    return { name: family, href: googleFontHref( family ) };
}

////////////////////////////////////////////////////////////////////////////////////////////
/** Ensure a set of families is loaded for preview — CHUNKED into small combined requests (a single URL with all
 *  ~90 families exceeds URL limits and fails, dropping every preview). Idempotent per chunk. */
export function ensureFamiliesLoaded( families : Array<string> ) : void
{
    const CHUNK : number = 10;
    for( let start : number = 0; start < families.length; start += CHUNK )
    {
        const group : Array<string> = families.slice( start, start + CHUNK );
        ensureStylesheet( googleFontsHref( group ) );
    }
}

////////////////////////////////////////////////////////////////////////////////////////////
/** Inject a stylesheet `<link>` once (idempotent) so a font family renders for preview. */
export function ensureStylesheet( href : string ) : void
{
    if( typeof document === "undefined" ) return;
    const existing : Element | null = document.querySelector( `link[data-brandfont="${ href }"]` );
    if( existing !== null ) return;
    const link : HTMLLinkElement = document.createElement( "link" );
    link.rel = "stylesheet";
    link.href = href;
    link.setAttribute( "data-brandfont", href );
    document.head.appendChild( link );
}
// eof
