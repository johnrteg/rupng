import { Account } from "@repo/api";

//
// SvgCatalog — a small curated catalog of generic vector graphics to browse + drop into content, plus helpers to
// RECOLOR an SVG to a brand color and turn markup into a data URL. Brand-owned SVGs (BYO) live on Account/Campaign
// (`Account.BrandSvg`); this catalog is the shared app-level set (grows over time). SVGs are stored as inline
// markup so their fills can be rewritten to the brand palette when placed.
//

/** A catalog entry — a name + inline `<svg>` markup (use explicit `fill`/`stroke` so recolor can rewrite them). */
export interface SvgEntry
{
    name : string;
    svg  : string;
}

/** The curated catalog. (Seeded with a few common marks; paste-your-own via BYO, or add exact art here.) */
export const SVG_CATALOG : Array<SvgEntry> =
[
    { name: "Recycle",  svg: `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path fill="#000000" d="M12 4V1L8 5l4 4V6c3.31 0 6 2.69 6 6 0 1.01-.25 1.97-.7 2.8l1.46 1.46A7.93 7.93 0 0 0 20 12c0-4.42-3.58-8-8-8zm0 14c-3.31 0-6-2.69-6-6 0-1.01.25-1.97.7-2.8L5.24 7.74A7.93 7.93 0 0 0 4 12c0 4.42 3.58 8 8 8v3l4-4-4-4v3z"/></svg>` },
    { name: "Star",     svg: `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path fill="#000000" d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>` },
    { name: "Heart",    svg: `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path fill="#000000" d="M12 21s-6.72-4.35-9.43-7.06A5.5 5.5 0 0 1 12 6.34a5.5 5.5 0 0 1 9.43 7.6C18.72 16.65 12 21 12 21z"/></svg>` },
    { name: "Circle",   svg: `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><circle cx="12" cy="12" r="9" fill="#000000"/></svg>` },
    { name: "Square",   svg: `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><rect x="4" y="4" width="16" height="16" rx="2" fill="#000000"/></svg>` },
    { name: "Bolt",     svg: `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path fill="#000000" d="M11 21h-1l1-7H6.5c-.58 0-.57-.32-.38-.66.19-.34.05-.08.07-.12C7.88 9.78 10.1 5.9 13 1h1l-1 7h4.5c.49 0 .56.33.47.51l-.07.15C13.96 14.6 11 21 11 21z"/></svg>` },
];

////////////////////////////////////////////////////////////////////////////////////////////
/** Rewrite an SVG's explicit `fill`/`stroke` colors (except `none`) to `color`. Attribute-based (keeps it
 *  predictable); SVGs using CSS `style="fill:…"` won't be caught — a limitation noted for the recolor step. */
export function recolorSvg( svg : string, color : string ) : string
{
    const filled : string = svg.replace( /fill="(?!none")[^"]*"/g, `fill="${ color }"` );
    return filled.replace( /stroke="(?!none")[^"]*"/g, `stroke="${ color }"` );
}

////////////////////////////////////////////////////////////////////////////////////////////
/** A data URL for inline SVG markup (for an `<img>` preview or an editor image asset). */
export function svgDataUrl( svg : string ) : string
{
    return `data:image/svg+xml;utf8,${ encodeURIComponent( svg ) }`;
}

////////////////////////////////////////////////////////////////////////////////////////////
/** Extract just the `<svg>…</svg>` element from pasted / imported markup — tolerant of a leading `<?xml …?>`
 *  declaration, a DOCTYPE, comments, or surrounding whitespace (common in downloaded .svg files). Null when no
 *  `<svg>` element is present. */
export function extractSvg( markup : string ) : string | null
{
    const start : number = markup.search( /<svg[\s>]/i );
    const closeMatch : RegExpMatchArray | null = markup.match( /<\/svg\s*>/i );
    if( start < 0 || closeMatch === null || closeMatch.index === undefined ) return null;
    return markup.slice( start, closeMatch.index + closeMatch[ 0 ].length );
}

/** A loose sanity check that a string CONTAINS an SVG element (BYO paste guard) — not that it starts with one. */
export function looksLikeSvg( markup : string ) : boolean
{
    return extractSvg( markup ) !== null;
}

////////////////////////////////////////////////////////////////////////////////////////////
/** A catalog entry as a `BrandSvg` (for adding to a theme's SVG list). */
export function toBrandSvg( entry : SvgEntry ) : Account.BrandSvg
{
    return { name: entry.name, svg: entry.svg };
}
// eof
