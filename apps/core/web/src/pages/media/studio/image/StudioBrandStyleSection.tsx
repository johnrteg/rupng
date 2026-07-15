import { JSX, useContext, useEffect } from "react";

import { useEditor, DefaultColorStyle, DefaultFontStyle, type Editor, type TLDefaultColorStyle, type TLDefaultFontStyle } from 'tldraw';

import { Account } from '@repo/api';

import AppModel from "@model/AppModel";
import { ensureStylesheet } from "@widgets/core/GoogleFonts";
import { StudioBrandContext, type StudioBrandContextValue } from "@pages/media/studio/image/StudioBrandContext";

//
// StudioBrandStyleSection — the FIRST custom addition to the editor's style panel: the acting account's brand
// palette as clickable swatches, above tldraw's default controls. Clicking a swatch applies the NEAREST tldraw
// color slot to the selected shapes (and to the next shape drawn). NOTE: tldraw's built-in shapes only accept
// its ~12 fixed color slots, so this maps a brand hex to the closest slot — true arbitrary hex (incl. exact
// white) needs the custom-shape layer we'll add next; this proves the seam + gives brand-approximate color now.
//

// tldraw's default LIGHT-mode color slots (name → hex) — the target set brand colors are matched against.
const TLDRAW_COLORS : Record<TLDefaultColorStyle, string> =
{
    white:         "#ffffff",
    black:         "#1d1d1d",
    grey:          "#9fa8b2",
    "light-violet":"#e085f4",
    violet:        "#ae3ec9",
    blue:          "#4465e9",
    "light-blue":  "#4ba1f1",
    yellow:        "#f1ac4b",
    orange:        "#e16919",
    green:         "#099268",
    "light-green": "#4cb05e",
    "light-red":   "#f87777",
    red:           "#e03131",
};

// parse "#rrggbb" → [r,g,b] (0 on a malformed value so a bad swatch just maps to black rather than throwing)
function toRgb( hex : string ) : [ number, number, number ]
{
    const clean : string = hex.replace( "#", "" );
    if( clean.length < 6 ) return [ 0, 0, 0 ];
    return [ parseInt( clean.slice( 0, 2 ), 16 ), parseInt( clean.slice( 2, 4 ), 16 ), parseInt( clean.slice( 4, 6 ), 16 ) ];
}

// the tldraw color-slot NAME closest to a brand hex (squared-euclidean RGB distance)
function nearestTldrawColor( hex : string ) : TLDefaultColorStyle
{
    const target : [ number, number, number ] = toRgb( hex );
    let best : TLDefaultColorStyle = "black";
    let bestDistance : number = Number.POSITIVE_INFINITY;
    for( const name of Object.keys( TLDRAW_COLORS ) as Array<TLDefaultColorStyle> )
    {
        const candidate : [ number, number, number ] = toRgb( TLDRAW_COLORS[ name ] );
        const distance : number = ( target[ 0 ] - candidate[ 0 ] ) ** 2 + ( target[ 1 ] - candidate[ 1 ] ) ** 2 + ( target[ 2 ] - candidate[ 2 ] ) ** 2;
        if( distance < bestDistance ) { bestDistance = distance; best = name; }
    }
    return best;
}

// the native tldraw font slots, named + previewed in their own family. (Additional/brand fonts need the
// custom-shape / assetUrls layer — these four are what the built-in shapes accept today.)
const STUDIO_FONTS : Array<{ label : string; value : TLDefaultFontStyle; css : string }> =
[
    { label: "Sans",  value: "sans",  css: "sans-serif" },
    { label: "Serif", value: "serif", css: "serif" },
    { label: "Mono",  value: "mono",  css: "monospace" },
    { label: "Draw",  value: "draw",  css: "cursive" },
];

// the native tldraw font slot that best matches a brand font by NAME (built-in shapes render one of the four
// native fonts; exact brand-font rendering on shapes needs the custom-shape/assetUrls layer — a later step).
function nativeFontFor( name : string ) : TLDefaultFontStyle
{
    const lower : string = name.toLowerCase();
    if( /mono|code|consol|courier/.test( lower ) ) return "mono";
    if( /script|hand|dancing|pacifico|lobster|caveat|satisfy|vibes|sacramento|marker|indie|kalam|brush/.test( lower ) ) return "draw";
    if( lower.includes( "sans" ) ) return "sans";
    if( /serif|slab|garamond|playfair|merriweather|baskerville|times|crimson|cormorant|lora|bitter|spectral|domine|vollkorn|cardo/.test( lower ) ) return "serif";
    return "sans";
}

// dedupe brand fonts by family name (account + campaign may overlap), preserving order
function dedupeFonts( fonts : Array<Account.BrandFont> ) : Array<Account.BrandFont>
{
    const seen : Set<string> = new Set();
    const out : Array<Account.BrandFont> = [];
    for( const font of fonts )
    {
        if( seen.has( font.name ) ) continue;
        seen.add( font.name );
        out.push( font );
    }
    return out;
}

//
// The brand-palette + font section rendered inside the custom style panel.
//
export function StudioBrandStyleSection() : JSX.Element
{
    const editor : Editor = useEditor();
    const context : StudioBrandContextValue = useContext( StudioBrandContext );
    const brand : Array<string> = AppModel.instance().account.palette ?? [];
    const campaign : Array<string> = context.campaignPalette;

    // brand fonts = account fonts + campaign fonts (deduped). When empty, the section falls back to tldraw's
    // native fonts (STUDIO_FONTS) so the editor always has usable font choices.
    const brandFonts : Array<Account.BrandFont> = dedupeFonts( [ ...( AppModel.instance().account.fonts ?? [] ), ...context.campaignFonts ] );

    ////////////////////////////////////////////////////////////////////////////////////////////
    useEffect( loadBrandFontPreviews );

    // inject each brand font's stylesheet so its button previews in-family
    function loadBrandFontPreviews() : void
    {
        brandFonts.forEach( ( font : Account.BrandFont ) : void => ensureStylesheet( font.href ) );
    }

    // WHITE is a native tldraw color slot but tldraw's default swatch grid omits it — so always offer it here
    // (first), followed by the account's brand colors. Dedupe so an account that already lists white isn't doubled.
    const hasWhite : boolean = brand.some( ( hex : string ) : boolean => hex.toLowerCase() === "#ffffff" || hex.toLowerCase() === "#fff" );
    const accountSwatches : Array<string> = hasWhite ? brand : [ "#ffffff", ...brand ];

    // apply a color to the current selection + the next-drawn shape (mapped to the nearest tldraw slot; an exact
    // #ffffff maps to the native `white` slot)
    function onSwatch( hex : string ) : void
    {
        const slot : TLDefaultColorStyle = nearestTldrawColor( hex );
        editor.setStyleForNextShapes( DefaultColorStyle, slot );
        editor.setStyleForSelectedShapes( DefaultColorStyle, slot );
    }

    // apply a font to the current selection + the next-drawn shape
    function onFont( value : TLDefaultFontStyle ) : void
    {
        editor.setStyleForNextShapes( DefaultFontStyle, value );
        editor.setStyleForSelectedShapes( DefaultFontStyle, value );
    }

    // a labeled row of clickable swatches (shared by the Brand + Campaign groups)
    function swatchGroup( label : string, colors : Array<string> ) : JSX.Element
    {
        return <div style={{ marginBottom: 8 }}>
                    <div style={{ fontSize: 11, fontWeight: 600, opacity: 0.6, marginBottom: 6 }}>{ label }</div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                        { colors.map( ( hex : string ) : JSX.Element => (
                            <div key={ label + "-" + hex }
                                 title={ hex }
                                 onClick={ () : void => onSwatch( hex ) }
                                 style={{ width: 22, height: 22, borderRadius: 4, backgroundColor: hex, border: "1px solid rgba(0,0,0,0.15)", cursor: "pointer" }} /> ) ) }
                    </div>
               </div>;
    }

    // the Font group: the account/campaign BRAND fonts when any are defined (previewed in-family; applied as the
    // nearest native slot), otherwise tldraw's native fonts as the standard fallback
    function fontGroup() : JSX.Element
    {
        if( brandFonts.length > 0 )
            return <div style={{ marginBottom: 8 }}>
                        <div style={{ fontSize: 11, fontWeight: 600, opacity: 0.6, marginBottom: 6 }}>{"Font"}</div>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                            { brandFonts.map( ( font : Account.BrandFont ) : JSX.Element => (
                                <div key={ font.name }
                                     title={ font.name }
                                     onClick={ () : void => onFont( nativeFontFor( font.name ) ) }
                                     style={{ padding: "2px 8px", borderRadius: 4, border: "1px solid rgba(0,0,0,0.15)", cursor: "pointer", fontFamily: `'${ font.name }', sans-serif`, fontSize: 14 }}>{ font.name }</div> ) ) }
                        </div>
                   </div>;

        return <div style={{ marginBottom: 8 }}>
                    <div style={{ fontSize: 11, fontWeight: 600, opacity: 0.6, marginBottom: 6 }}>{"Font"}</div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                        { STUDIO_FONTS.map( ( font : { label : string; value : TLDefaultFontStyle; css : string } ) : JSX.Element => (
                            <div key={ font.value }
                                 title={ font.label }
                                 onClick={ () : void => onFont( font.value ) }
                                 style={{ minWidth: 30, padding: "2px 8px", textAlign: "center", borderRadius: 4, border: "1px solid rgba(0,0,0,0.15)", cursor: "pointer", fontFamily: font.css, fontSize: 15 }}>{"Aa"}</div> ) ) }
                    </div>
               </div>;
    }

    return <div style={{ padding: "8px 10px 2px", borderBottom: "1px solid rgba(0,0,0,0.08)" }}>
                { swatchGroup( "Brand", accountSwatches ) }
                { campaign.length > 0 ? swatchGroup( "Campaign", campaign ) : null }
                { fontGroup() }
           </div>;
}

export default StudioBrandStyleSection;
// eof
