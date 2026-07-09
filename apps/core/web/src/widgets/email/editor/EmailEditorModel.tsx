import { EmailTemplate, Media } from '@repo/api';

import SelectInput from '@widgets/core/SelectInput';
import SelectMultInput from '@widgets/core/SelectMultInput';
import ColorPicker from '@widgets/core/ColorPicker';

//
// EmailEditorModel — the shared, component-free constants + pure helpers for the email editor family
// (widgets/email/editor). Choice lists, the MJML attribute catalog, the color/font palettes, block/section
// summaries + icons. No React state; safe to import from any editor sub-component.
//

// sample merge data so a preview shows real values for the standard tokens
export const SAMPLE_MERGE : Record<string, unknown> =
{
    name: { first: "Jane", last: "Doe", full: "Jane Doe" },
    email: "jane@example.com",
    address: { street1: "123 Main St", city: "Austin", state: "TX", zip: "78701" },
    account: { name: "Acme Co", address: "500 Congress Ave, Austin TX" },
    campaign: { name: "Spring Sale" },
    unsubscribe_url: "#",
};

// the content-block kinds addable within a column (the common MJML content components)
export const BLOCK_KINDS : Array<{ type : EmailTemplate.BlockType; label : string }> =
[
    { type: EmailTemplate.BlockType.TEXT,    label: "Text" },
    { type: EmailTemplate.BlockType.IMAGE,   label: "Image" },
    { type: EmailTemplate.BlockType.BUTTON,  label: "Button" },
    { type: EmailTemplate.BlockType.DIVIDER, label: "Divider" },
    { type: EmailTemplate.BlockType.SPACER,  label: "Spacer" },
    { type: EmailTemplate.BlockType.TABLE,   label: "Table" },
    { type: EmailTemplate.BlockType.SOCIAL,  label: "Social" },
    { type: EmailTemplate.BlockType.HTML,    label: "Raw HTML" },
];

// alignment / mode choice lists reused by the inspector
export const ALIGN_CHOICES : Array<SelectInput.Choice> = [ { value: "left", label: "Left" }, { value: "center", label: "Center" }, { value: "right", label: "Right" } ];
export const VALIGN_CHOICES : Array<SelectInput.Choice> = [ { value: "top", label: "Top" }, { value: "middle", label: "Middle" }, { value: "bottom", label: "Bottom" } ];
export const HERO_MODE_CHOICES : Array<SelectInput.Choice> = [ { value: "fluid-height", label: "Fluid height" }, { value: "fixed-height", label: "Fixed height" } ];
export const SOCIAL_NETWORKS : Array<SelectInput.Choice> = [ "facebook", "twitter", "linkedin", "instagram", "youtube", "pinterest", "github", "web" ].map( ( name : string ) : SelectInput.Choice => ( { value: name, label: name } ) );

// the typical base URL to PREFILL when a social network is chosen (the profile-path prefix the user completes)
const SOCIAL_BASE_URL : Record<string, string> =
{
    facebook:  "https://facebook.com/",
    twitter:   "https://twitter.com/",
    linkedin:  "https://linkedin.com/in/",
    instagram: "https://instagram.com/",
    youtube:   "https://youtube.com/@",
    pinterest: "https://pinterest.com/",
    github:    "https://github.com/",
    web:       "https://",
};
export function socialBaseUrl( network : string ) : string { return SOCIAL_BASE_URL[ network ] ?? "https://"; }

// the STANDARD MJML attributes documented per component type — drives the Attributes panel's name dropdown.
// `COMMON_ATTRS` apply to (nearly) every element.
const COMMON_ATTRS : Array<string> = [ "css-class", "padding", "padding-top", "padding-right", "padding-bottom", "padding-left", "container-background-color" ];
const MJML_ATTRS : Partial<Record<EmailTemplate.BlockType, Array<string>>> =
{
    [ EmailTemplate.BlockType.SECTION ]:        [ "background-color", "background-url", "background-repeat", "background-size", "background-position", "border", "border-radius", "direction", "full-width", "text-align" ],
    [ EmailTemplate.BlockType.COLUMN ]:         [ "background-color", "border", "border-radius", "inner-border", "vertical-align", "width" ],
    [ EmailTemplate.BlockType.GROUP ]:          [ "background-color", "direction", "vertical-align", "width" ],
    [ EmailTemplate.BlockType.WRAPPER ]:        [ "background-color", "background-url", "background-repeat", "background-size", "background-position", "border", "border-radius", "full-width", "text-align" ],
    [ EmailTemplate.BlockType.HERO ]:           [ "mode", "height", "background-url", "background-width", "background-height", "background-color", "background-position", "border-radius", "vertical-align", "width" ],
    [ EmailTemplate.BlockType.TEXT ]:           [ "color", "font-family", "font-size", "font-style", "font-weight", "line-height", "letter-spacing", "height", "text-decoration", "text-transform", "align" ],
    [ EmailTemplate.BlockType.IMAGE ]:          [ "alt", "href", "name", "src", "srcset", "sizes", "title", "rel", "align", "border", "border-radius", "fluid-on-mobile", "width", "height", "target" ],
    [ EmailTemplate.BlockType.BUTTON ]:         [ "background-color", "border", "border-radius", "color", "font-family", "font-size", "font-style", "font-weight", "height", "href", "inner-padding", "letter-spacing", "line-height", "rel", "target", "text-align", "text-decoration", "text-transform", "vertical-align", "width" ],
    [ EmailTemplate.BlockType.DIVIDER ]:        [ "border-color", "border-style", "border-width", "width", "align" ],
    [ EmailTemplate.BlockType.SPACER ]:         [ "height" ],
    [ EmailTemplate.BlockType.TABLE ]:          [ "align", "border", "cellpadding", "cellspacing", "color", "font-family", "font-size", "line-height", "table-layout", "width" ],
    [ EmailTemplate.BlockType.SOCIAL ]:         [ "align", "border-radius", "color", "font-family", "font-size", "font-style", "font-weight", "icon-size", "icon-height", "icon-padding", "inner-padding", "line-height", "mode", "text-padding", "text-decoration" ],
    [ EmailTemplate.BlockType.SOCIAL_ELEMENT ]: [ "align", "alt", "background-color", "border-radius", "color", "href", "icon-size", "icon-height", "name", "src", "target", "title" ],
    [ EmailTemplate.BlockType.NAVBAR ]:         [ "align", "base-url", "hamburger", "ico-align", "ico-color", "ico-font-size" ],
    [ EmailTemplate.BlockType.NAVBAR_LINK ]:    [ "color", "font-family", "font-size", "font-style", "font-weight", "href", "line-height", "rel", "target", "text-decoration", "text-transform" ],
    [ EmailTemplate.BlockType.ACCORDION ]:      [ "border", "font-family", "icon-align", "icon-height", "icon-width", "icon-position", "icon-wrapped-url", "icon-unwrapped-url" ],
    [ EmailTemplate.BlockType.ACCORDION_ELEMENT ]: [ "background-color", "border", "font-family", "icon-align", "icon-height", "icon-width" ],
    [ EmailTemplate.BlockType.CAROUSEL ]:       [ "align", "border-radius", "icon-width", "left-icon", "right-icon", "tb-border", "tb-border-radius", "tb-hover-border-color", "tb-selected-border-color", "tb-width", "thumbnails" ],
    [ EmailTemplate.BlockType.CAROUSEL_IMAGE ]: [ "alt", "href", "rel", "target", "src", "thumbnails-src", "title" ],
};
// the standard attribute names for a block type (its own set + the common ones), sorted, de-duplicated
export function standardAttrs( type : EmailTemplate.BlockType ) : Array<string>
{
    const own : Array<string> = MJML_ATTRS[ type ] ?? [];
    return Array.from( new Set( [ ...own, ...COMMON_ATTRS ] ) ).sort();
}

// the DISPLAY variant (rendition) choices for a library image — item key `display.<profile>`; mobile is default
export const IMAGE_VARIANTS : Array<SelectInput.Choice> = Media.DISPLAY_VARIANTS.map( ( spec : Media.VariantSpec ) : SelectInput.Choice => ( { value: Media.itemKey( Media.Usage.DISPLAY, spec.label ), label: `${ spec.label } (${ spec.width }px)` } ) );
export const DEFAULT_IMAGE_VARIANT : string = Media.itemKey( Media.Usage.DISPLAY, "mobile" );

// the color-picker preset palette for email colors (white/black + the house swatches + greys)
export const EMAIL_COLORS : Array<string> = [ "#ffffff", "#000000", ...ColorPicker.COLORS, ...ColorPicker.GREYS ];

// web-/email-SAFE font families — pre-installed across the common clients (no web-font download) + the generic
// CSS fallbacks. Chosen as an ordered stack (chips).
const SAFE_FONTS : Array<string> =
[
    "Arial", "Helvetica", "Helvetica Neue", "Verdana", "Tahoma", "Trebuchet MS", "Segoe UI", "Gill Sans",
    "Times New Roman", "Georgia", "Garamond", "Palatino Linotype", "Cambria",
    "Courier New", "Lucida Console", "Lucida Sans Unicode",
    "sans-serif", "serif", "monospace",
];
export const FONT_CHOICES : Array<SelectMultInput.Choice> = SAFE_FONTS.map( ( family : string ) : SelectMultInput.Choice => ( { value: family, label: family } ) );

// a one-line summary of a content block (for the block row)
export function blockSummary( block : EmailTemplate.Block ) : string
{
    if( block.type === EmailTemplate.BlockType.TEXT )    return String( block.props?.html ?? "" ).replace( /<[^>]+>/g, "" ).slice( 0, 60 ) || "(empty text)";
    if( block.type === EmailTemplate.BlockType.IMAGE )   return `Image · ${ String( block.props?.assetName ?? block.props?.src ?? "(no image)" ) }`;
    if( block.type === EmailTemplate.BlockType.BUTTON )  return `Button · ${ String( block.props?.text ?? "" ) }`;
    if( block.type === EmailTemplate.BlockType.DIVIDER ) return "Divider";
    if( block.type === EmailTemplate.BlockType.SPACER )  return `Spacer · ${ String( block.props?.height ?? "20px" ) }`;
    if( block.type === EmailTemplate.BlockType.TABLE )   return "Table";
    if( block.type === EmailTemplate.BlockType.SOCIAL )  return `Social · ${ ( block.children ?? [] ).length } links`;
    if( block.type === EmailTemplate.BlockType.HTML )    return "Raw HTML";
    return block.type;
}

// the base font family is a CSS font STACK — round-trip it to/from an ordered list of family names for the chip
// multi-select (multi-word names are quoted when re-joined into the stack)
export function fontStackToList( stack : string ) : Array<string>
{
    return stack.split( "," ).map( ( part : string ) : string => part.trim().replace( /^["']|["']$/g, "" ) ).filter( ( family : string ) : boolean => family !== "" );
}
export function fontListToStack( families : Array<string> ) : string
{
    return families.map( ( family : string ) : string => family.includes( " " ) ? `"${ family }"` : family ).join( ", " );
}
// eof
