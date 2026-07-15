//
// SvgDocument — the canonical editable model for the SVG design editor (media Studio). Stored as a JSON file
// in S3 (`svg-docs/{accountId}/{projectId}.json`); DynamoDB holds only the metadata row + the S3 canvasKey.
// SVG is a lossless VIEW/EXPORT of this doc, never the editable form. Document history is S3 object
// versioning — no save-counter lives here; `SCHEMA_VERSION` is a JSON-shape migration marker ONLY.
//
// Single source of truth (owned by the media service, imported by the web editor — never re-declared at a
// call site). All positions are in POINTS (pt; 1pt = 1/72in); unit labels on pages are display-only.
//
export namespace SvgDocument
{
    // ── Top-level document ──────────────────────────────────────────────────

    /** The whole design: pages, its embedded/linked assets, reusable styles, merge variables, brand link,
     *  plugin state, and the export defaults. `schemaVersion` migrates the JSON shape; it is NOT a counter. */
    export interface Doc
    {
        readonly schemaVersion  : number;               // incremented only on a breaking JSON shape change; not a save counter
        readonly id             : string;               // matches SvgProject.id
        readonly pages          : Array<Page>;
        readonly assets         : Array<Asset>;         // embedded/linked media
        readonly styles         : StyleLibrary;
        readonly variables      : VariableSet;
        readonly brand          : BrandRef | null;      // linked brand package id
        readonly plugins        : Array<PluginState>;
        readonly exportSettings : ExportSettings;
    }

    // ── Pages ───────────────────────────────────────────────────────────────

    /** A single page/artboard: its size + print margins (bleed/safe area), background, ordered layers, and
     *  editor guides/grid. Layers paint bottom-to-top (same as SVG z-order). */
    export interface Page
    {
        readonly id          : string;
        readonly name        : string;
        readonly size        : PageSize;
        readonly orientation : Orientation;
        readonly bleed       : number;                  // pt
        readonly safeArea    : number;                  // pt
        readonly background  : Background;
        readonly layers      : Array<Layer>;
        readonly guides      : Array<Guide>;
        readonly grid        : GridSettings | null;
    }

    /** A page's dimensions in points plus its display unit + raster export density. */
    export interface PageSize
    {
        readonly preset : PagePreset | null;            // null = custom
        readonly width  : number;                       // in points (1pt = 1/72 in)
        readonly height : number;
        readonly unit   : Unit;                         // display unit (does not change the stored value)
        readonly dpi    : number;                       // for raster export only
    }

    /** The named starter page sizes (print + social). Comments give the size in the natural unit. */
    export enum PagePreset
    {
        LETTER          = "letter",          // 612 × 792 pt
        LEGAL           = "legal",           // 612 × 1008 pt
        TABLOID         = "tabloid",         // 792 × 1224 pt
        A4              = "a4",              // 595 × 842 pt
        A5              = "a5",              // 420 × 595 pt
        POSTCARD_4X6    = "postcard_4x6",    // 288 × 432 pt
        RACK_CARD       = "rack_card",       // 252 × 648 pt
        DOOR_HANGER     = "door_hanger",     // 144 × 360 pt
        BUSINESS_CARD   = "business_card",   // 252 × 144 pt
        SOCIAL_1X1      = "social_1x1",      // 1080 × 1080 px (px-native)
        SOCIAL_16X9     = "social_16x9",     // 1920 × 1080 px
        SOCIAL_9X16     = "social_9x16",     // 1080 × 1920 px
    }

    /** Display units for measurement fields — the stored value stays in pt regardless. */
    export enum Unit  { INCHES = "in", MM = "mm", PX = "px", PT = "pt" }
    /** Page orientation. */
    export enum Orientation { PORTRAIT = "portrait", LANDSCAPE = "landscape" }

    /** A ruler guide line at a fixed axis position (pt). */
    export interface Guide { axis : "x" | "y"; position : number; }

    /** A layout grid overlay for a page (columns/rows + gutters), optionally snap-enabled. */
    export interface GridSettings
    {
        readonly columns : number;
        readonly rows    : number;
        readonly gutter  : number;
        readonly margin  : number;
        readonly visible : boolean;
        readonly snap    : boolean;
    }

    /** A page background — a solid color, an image asset, or none (transparent). */
    export interface Background
    {
        readonly kind    : "color" | "image" | "none";
        readonly color   : string | null;   // hex
        readonly assetId : string | null;   // ref into doc.assets
    }

    // ── Layers ──────────────────────────────────────────────────────────────

    /** A layer within a page — a named, lockable/hideable stack of objects with its own opacity. */
    export interface Layer
    {
        readonly id      : string;
        readonly name    : string;
        readonly locked  : boolean;
        readonly hidden  : boolean;
        readonly opacity : number;          // 0–1
        readonly objects : Array<ObjectNode>;
    }

    // ── Object tree ─────────────────────────────────────────────────────────

    /** The discriminated union of everything placeable on the canvas. */
    export type ObjectNode =
        | TextNode
        | ImageNode
        | ShapeNode
        | GroupNode
        | ComponentNode
        | GeneratedNode;

    /** The object kind discriminant (matches each node's `kind`). */
    export enum ObjectKind
    {
        TEXT       = "text",
        IMAGE      = "image",
        SHAPE      = "shape",
        GROUP      = "group",
        COMPONENT  = "component",
        GENERATED  = "generated",
    }

    /** Fields common to every object: identity, lock/hide, transform, opacity, and a v2 conditional-
     *  visibility rule (stored now, not evaluated in v1). */
    export interface ObjectBase
    {
        readonly id                   : string;
        readonly kind                 : ObjectKind;
        readonly name                 : string;
        readonly locked               : boolean;
        readonly hidden               : boolean;
        readonly transform            : Transform;
        readonly opacity              : number;
        readonly conditionalVisibility: ConditionalVisibility | null;   // v2 — show/hide based on variable value; null = always visible
    }

    // ── Conditional visibility (v2 placeholder) ─────────────────────────────
    // Not rendered in v1; reserved so the doc model can carry the data without a breaking schema change when
    // the feature ships.

    /** A v2 rule that shows/hides an object based on a merge variable's value. Reserved; not evaluated in v1. */
    export interface ConditionalVisibility
    {
        readonly variable : string;                    // VariableField.key
        readonly operator : ConditionalOperator;
        readonly value    : string;                    // compared value (string-serialized)
    }

    /** Comparison operators for a {@link ConditionalVisibility} rule. */
    export enum ConditionalOperator
    {
        EQ      = "eq",       // variable === value
        NEQ     = "neq",      // variable !== value
        TRUTHY  = "truthy",   // Boolean(variable) === true  (value ignored)
        FALSY   = "falsy",    // Boolean(variable) === false (value ignored)
        GT      = "gt",       // Number(variable) > Number(value)
        LT      = "lt",       // Number(variable) < Number(value)
    }

    /** A decomposed 2D transform (composed to an SVG `transform` on render). Position/size in pt. */
    export interface Transform
    {
        readonly x        : number;
        readonly y        : number;
        readonly width    : number;
        readonly height   : number;
        readonly rotation : number;         // degrees
        readonly scaleX   : number;
        readonly scaleY   : number;
        readonly flipH    : boolean;
        readonly flipV    : boolean;
        readonly anchor   : AnchorPoint;
    }

    /** The nine reference points a transform's x/y can be measured from. */
    export enum AnchorPoint
    {
        TOP_LEFT     = "tl", TOP_CENTER    = "tc", TOP_RIGHT    = "tr",
        MIDDLE_LEFT  = "ml", CENTER        = "c",  MIDDLE_RIGHT = "mr",
        BOTTOM_LEFT  = "bl", BOTTOM_CENTER = "bc", BOTTOM_RIGHT = "br",
    }

    // ── Text ────────────────────────────────────────────────────────────────

    /** A text object — rich spans, an optional text-on-path target, and vertical/curved flags. */
    export interface TextNode extends ObjectBase
    {
        readonly kind       : ObjectKind.TEXT;
        readonly role       : TextRole;
        readonly content    : Array<TextSpan>;     // rich spans
        readonly pathId     : string | null;       // text-on-path: target shape id
        readonly curved     : boolean;
        readonly vertical   : boolean;
    }

    /** Named typographic roles that map to a style in the StyleLibrary. */
    export enum TextRole
    {
        HEADLINE = "headline",
        BODY     = "body",
        CAPTION  = "caption",
        QUOTE    = "quote",
        CUSTOM   = "custom",
    }

    /** A run of text with its own styling within a TextNode. */
    export interface TextSpan
    {
        readonly text     : string;
        readonly style    : TextStyle;
    }

    /** The full styling for a text span (font, color, spacing, decoration, optional named style ref). */
    export interface TextStyle
    {
        readonly fontFamily   : string;
        readonly fontWeight   : number | string;
        readonly fontSize     : number;            // pt
        readonly color        : string;            // hex or var ref: "{{BrandPrimary}}"
        readonly align        : "left" | "center" | "right" | "justify";
        readonly lineSpacing  : number;            // em
        readonly letterSpacing: number;            // em
        readonly paragraphSpacing : number;        // pt
        readonly stroke       : Stroke | null;
        readonly shadow       : Shadow | null;
        readonly styleRef     : string | null;     // named style id from StyleLibrary
    }

    // ── Image ───────────────────────────────────────────────────────────────

    /** An image object — references an asset; optional crop/mask/frame + adjustment filters. */
    export interface ImageNode extends ObjectBase
    {
        readonly kind    : ObjectKind.IMAGE;
        readonly assetId : string;               // ref into doc.assets
        readonly crop    : CropRect | null;
        readonly mask    : MaskRef | null;
        readonly frame   : FrameShape | null;
        readonly filters : ImageFilters;
    }

    /** A crop rectangle (in pt) into the source image. */
    export interface CropRect  { x : number; y : number; width : number; height : number; }
    /** A mask reference — clips the image to another shape object. */
    export interface MaskRef   { shapeId : string; }
    /** Built-in image frame shapes. */
    export enum FrameShape     { CIRCLE = "circle", ROUNDED = "rounded", CUSTOM = "custom" }

    /** Per-image color adjustments applied at render time. */
    export interface ImageFilters
    {
        readonly brightness  : number;   // -1 to 1
        readonly contrast    : number;
        readonly saturation  : number;
        readonly blur        : number;   // px
        readonly colorOverlay: string | null;
    }

    // ── Shape ───────────────────────────────────────────────────────────────

    /** A vector shape — a primitive or a custom `d=` path; fill/stroke/shadow + primitive-specific fields. */
    export interface ShapeNode extends ObjectBase
    {
        readonly kind        : ObjectKind.SHAPE;
        readonly shapeType   : ShapeType;
        readonly pathData    : string | null;      // SVG path d= for custom shapes
        readonly fill        : Fill;
        readonly stroke      : Stroke | null;
        readonly shadow      : Shadow | null;
        readonly cornerRadius: number;             // for rects
        readonly sides       : number;             // for polygon/star
        readonly innerRadius : number;             // for star
    }

    /** The supported shape primitives (plus PATH/CUSTOM for arbitrary geometry). */
    export enum ShapeType
    {
        RECT    = "rect",
        CIRCLE  = "circle",
        ELLIPSE = "ellipse",
        POLYGON = "polygon",
        LINE    = "line",
        ARROW   = "arrow",
        STAR    = "star",
        PATH    = "path",
        CUSTOM  = "custom",
    }

    /** A shape/text fill — solid color, gradient, pattern, or none. */
    export type Fill = SolidFill | GradientFill | PatternFill | NoneFill;

    /** A solid color fill. */
    export interface SolidFill    { kind : "solid";    color    : string; }
    /** A gradient fill. */
    export interface GradientFill { kind : "gradient"; gradient : Gradient; }
    /** A pattern fill (SVG pattern ref). */
    export interface PatternFill  { kind : "pattern";  pattern  : string; }
    /** No fill (transparent). */
    export interface NoneFill     { kind : "none"; }

    /** A linear/radial gradient with ordered color stops. */
    export interface Gradient
    {
        readonly type   : "linear" | "radial";
        readonly angle  : number;
        readonly stops  : Array<GradientStop>;
    }
    /** A single gradient stop (offset 0–1, color, and opacity 0–1). */
    export interface GradientStop { offset : number; color : string; opacity : number; }

    /** A stroke (outline) definition. */
    export interface Stroke
    {
        readonly color    : string;
        readonly width    : number;
        readonly dash     : string | null;         // SVG stroke-dasharray
        readonly lineCap  : "butt" | "round" | "square";
        readonly lineJoin : "miter" | "round" | "bevel";
    }

    /** A drop shadow. */
    export interface Shadow
    {
        readonly color   : string;
        readonly offsetX : number;
        readonly offsetY : number;
        readonly blur    : number;
        readonly opacity : number;
    }

    // ── Group ───────────────────────────────────────────────────────────────

    /** A group — a transformable container of child objects (nested groups allowed). */
    export interface GroupNode extends ObjectBase
    {
        readonly kind    : ObjectKind.GROUP;
        readonly objects : Array<ObjectNode>;
    }

    // ── Component (reusable design block) ───────────────────────────────────

    /** An instance of a reusable component from the StyleLibrary, with per-instance overrides. */
    export interface ComponentNode extends ObjectBase
    {
        readonly kind        : ObjectKind.COMPONENT;
        readonly componentId : string;             // ref into StyleLibrary.components
        readonly overrides   : Record<string, unknown>;
    }

    // ── Generated (plugin-driven, data-backed) ───────────────────────────────

    /** A plugin-generated object (QR, barcode, …) — typed params + a cached SVG fragment for fast redraw. */
    export interface GeneratedNode extends ObjectBase
    {
        readonly kind       : ObjectKind.GENERATED;
        readonly pluginId   : string;              // e.g. "qrcode", "barcode"
        readonly params     : Record<string, unknown>;
        readonly cachedSvg  : string | null;       // last rendered output (display only)
    }

    // ── Style Library ────────────────────────────────────────────────────────

    /** Reusable named styles + components shared across the doc. */
    export interface StyleLibrary
    {
        readonly textStyles      : Array<NamedTextStyle>;
        readonly objectStyles    : Array<NamedObjectStyle>;
        readonly colorStyles     : Array<NamedColor>;
        readonly components      : Array<ComponentDefinition>;
    }

    /** A named text style. */
    export interface NamedTextStyle   { id : string; name : string; style : TextStyle; }
    /** A named object (fill/stroke/shadow) style. */
    export interface NamedObjectStyle { id : string; name : string; fill  : Fill; stroke : Stroke | null; shadow : Shadow | null; }
    /** A named document color. */
    export interface NamedColor       { id : string; name : string; value : string; }

    /** A reusable component definition — a named object subtree. */
    export interface ComponentDefinition
    {
        readonly id      : string;
        readonly name    : string;
        readonly objects : Array<ObjectNode>;   // the template tree
    }

    // ── Variables ─────────────────────────────────────────────────────────────

    /** The merge-variable set — field definitions + sample preview data. */
    export interface VariableSet
    {
        readonly fields  : Array<VariableField>;
        readonly preview : Record<string, string>;   // sample data for editor preview
    }

    /** One merge field. */
    export interface VariableField
    {
        readonly key   : string;         // "FirstName"
        readonly label : string;         // "First Name"
        readonly type  : VariableType;
        readonly defaultValue : string;
    }

    /** The kinds of merge variable and how each substitutes. */
    export enum VariableType
    {
        TEXT    = "text",
        NUMBER  = "number",
        DATE    = "date",
        URL     = "url",
        QR_CODE = "qr_code",           // value becomes the QR payload
        IMAGE   = "image",             // value is a media asset URL
    }

    // ── Brand ─────────────────────────────────────────────────────────────────

    /** A link to an account brand package (optionally locking off-brand color/font choices). */
    export interface BrandRef
    {
        readonly brandId : string;
        readonly locked  : boolean;    // prevent off-brand color/font choices
    }

    // ── Plugin state ─────────────────────────────────────────────────────────

    /** Per-plugin enable flag + config carried on the doc. */
    export interface PluginState
    {
        readonly pluginId : string;
        readonly enabled  : boolean;
        readonly config   : Record<string, unknown>;
    }

    // ── Export settings ──────────────────────────────────────────────────────

    /** The default/target export configuration (format, density, fonts, marks, color space). */
    export interface ExportSettings
    {
        readonly format         : ExportFormat;
        readonly dpi            : number;
        readonly outlineFonts   : boolean;
        readonly embedFonts     : boolean;
        readonly colorSpace     : "rgb" | "cmyk";
        readonly includeCropMarks         : boolean;
        readonly includeRegistrationMarks : boolean;
        readonly includeColorBars         : boolean;
        readonly includeBleed             : boolean;
        readonly transparentBackground    : boolean;
    }

    /** The supported export formats. */
    export enum ExportFormat { SVG = "svg", PNG = "png", JPEG = "jpeg", PDF = "pdf" }

    // ── Asset registry ───────────────────────────────────────────────────────

    /** An embedded/linked asset (image, standalone SVG, or a font stylesheet URL). */
    export interface Asset
    {
        readonly id      : string;
        readonly kind    : AssetKind;
        readonly mediaId : string | null;          // link to media library asset (images/SVGs from media library)
        readonly cdnUrl  : string | null;          // CDN URL — Google Fonts stylesheet URL for kind=FONT_CDN;
                                                   //            future: account-hosted font on S3/CDN for kind=FONT_CUSTOM
        readonly embedded: string | null;          // base64 for small inline SVG icons only
        readonly name    : string;
        readonly mimeType: string;
    }

    /** The asset kinds — media images/SVGs, and font stylesheet sources (CDN now, custom later). */
    export enum AssetKind
    {
        IMAGE       = "image",        // PNG, JPEG, SVG from media library
        SVG         = "svg",          // standalone SVG asset
        FONT_CDN    = "font_cdn",     // Google Fonts (or any external CDN font stylesheet URL)
        FONT_CUSTOM = "font_custom",  // placeholder: future account-uploaded font hosted on S3/CDN
    }

    // ── Schema version + defaults ───────────────────────────────────────────

    /** The current JSON shape version — a migration marker only (NOT a save counter). */
    export const SCHEMA_VERSION : number = 1;

    /** The default export settings (Google Fonts embedded by default). */
    export const DEFAULT_EXPORT_SETTINGS : ExportSettings = {
        format                    : ExportFormat.PDF,
        dpi                       : 300,
        outlineFonts              : true,
        embedFonts                : true,           // Google Fonts embedded by default
        colorSpace                : "rgb",
        includeCropMarks          : false,
        includeRegistrationMarks  : false,
        includeColorBars          : false,
        includeBleed              : false,
        transparentBackground     : false,
    };
}

export default SvgDocument;
// eof
