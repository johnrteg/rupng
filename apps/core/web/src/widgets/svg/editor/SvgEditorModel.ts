//
import { SvgDocument } from "@repo/api";

//
// SvgEditorModel — the shared, component-free constants + pure helpers for the SVG editor family
// (widgets/svg). Tool definitions, unit conversion, page-size presets, snap config, model defaults + factory
// helpers, the Google-Fonts shortlist, AND the editor's ephemeral state shape + reducer-action union (so the
// reducer/context can import them without a React dependency). No React here; safe to import anywhere.
//

// ── Tools ───────────────────────────────────────────────────────────────────

/** The editor's interaction tools (matches the SVG_EDITOR_SPEC ToolMode set). */
export enum ToolMode
{
    SELECT = "select", TEXT = "text", SHAPE = "shape",
    PEN = "pen", IMAGE = "image", PAN = "pan", ZOOM = "zoom",
}

/** One tool's palette entry — its mode, its label, and its keyboard shortcut. */
export interface ToolDef
{
    readonly tool     : ToolMode;
    readonly label    : string;
    readonly shortcut : string;
}

/** The ordered tool palette shown in the main toolbar. */
export const TOOL_MODES : Array<ToolDef> =
[
    { tool: ToolMode.SELECT, label: "Select",    shortcut: "V" },
    { tool: ToolMode.TEXT,   label: "Text",      shortcut: "T" },
    { tool: ToolMode.SHAPE,  label: "Rectangle", shortcut: "R" },
    { tool: ToolMode.IMAGE,  label: "Image",     shortcut: "I" },
    { tool: ToolMode.PEN,    label: "Pen",       shortcut: "P" },
    { tool: ToolMode.PAN,    label: "Pan",       shortcut: "Space" },
    { tool: ToolMode.ZOOM,   label: "Zoom",      shortcut: "Z" },
];

// ── Units + geometry ──────────────────────────────────────────────────────────

/** Snap distance (in screen px) within which edges/guides attract during a drag. */
export const SNAP_THRESHOLD : number = 4;

/** Points per inch — the document's base coordinate system (1pt = 1/72in). */
const POINTS_PER_INCH : number = 72;
/** Millimetres per inch (unit conversion constant). */
const MM_PER_INCH : number = 25.4;

/** Convert a value in points to the given display unit (dpi drives the pt↔px mapping). */
export function ptToUnit( pt : number, unit : SvgDocument.Unit, dpi : number ) : number
{
    // pt is the stored base; each branch maps it to the requested display unit
    switch( unit )
    {
        case SvgDocument.Unit.INCHES : return pt / POINTS_PER_INCH;
        case SvgDocument.Unit.MM     : return ( pt / POINTS_PER_INCH ) * MM_PER_INCH;
        case SvgDocument.Unit.PX     : return ( pt / POINTS_PER_INCH ) * dpi;
        case SvgDocument.Unit.PT     : return pt;
        default                      : return pt;
    }
}

/** Convert a value in the given display unit back to points (the inverse of {@link ptToUnit}). */
export function unitToPt( value : number, unit : SvgDocument.Unit, dpi : number ) : number
{
    // invert each mapping so a property-panel edit round-trips to the stored pt value
    switch( unit )
    {
        case SvgDocument.Unit.INCHES : return value * POINTS_PER_INCH;
        case SvgDocument.Unit.MM     : return ( value / MM_PER_INCH ) * POINTS_PER_INCH;
        case SvgDocument.Unit.PX     : return ( value / dpi ) * POINTS_PER_INCH;
        case SvgDocument.Unit.PT     : return value;
        default                      : return value;
    }
}

/** A page's pixel/point extent. */
export interface PresetSize
{
    readonly width  : number;
    readonly height : number;
}

/** The named page presets → their size in points (print sizes are in/72; social sizes are px-native 1:1). */
export const PAGE_PRESETS : Record<SvgDocument.PagePreset, PresetSize> =
{
    [ SvgDocument.PagePreset.LETTER ]        : { width: 612,  height: 792 },
    [ SvgDocument.PagePreset.LEGAL ]         : { width: 612,  height: 1008 },
    [ SvgDocument.PagePreset.TABLOID ]       : { width: 792,  height: 1224 },
    [ SvgDocument.PagePreset.A4 ]            : { width: 595,  height: 842 },
    [ SvgDocument.PagePreset.A5 ]            : { width: 420,  height: 595 },
    [ SvgDocument.PagePreset.POSTCARD_4X6 ]  : { width: 288,  height: 432 },
    [ SvgDocument.PagePreset.RACK_CARD ]     : { width: 252,  height: 648 },
    [ SvgDocument.PagePreset.DOOR_HANGER ]   : { width: 144,  height: 360 },
    [ SvgDocument.PagePreset.BUSINESS_CARD ] : { width: 252,  height: 144 },
    [ SvgDocument.PagePreset.SOCIAL_1X1 ]    : { width: 1080, height: 1080 },
    [ SvgDocument.PagePreset.SOCIAL_16X9 ]   : { width: 1920, height: 1080 },
    [ SvgDocument.PagePreset.SOCIAL_9X16 ]   : { width: 1080, height: 1920 },
};

// ── Model defaults ──────────────────────────────────────────────────────────

/** The document's default background color (data, not chrome). */
const DEFAULT_BACKGROUND_COLOR : string = "#ffffff";
/** The default text fill color (data, not chrome). */
const DEFAULT_TEXT_COLOR : string = "#111111";
/** The default shape fill color (data, not chrome). */
const DEFAULT_SHAPE_COLOR : string = "#3366ff";

/** A neutral default text style for a freshly-added text object. */
export const DEFAULT_TEXT_STYLE : SvgDocument.TextStyle =
{
    fontFamily: "Inter", fontWeight: 400, fontSize: 16, color: DEFAULT_TEXT_COLOR,
    align: "left", lineSpacing: 1.2, letterSpacing: 0, paragraphSpacing: 0,
    stroke: null, shadow: null, styleRef: null,
};

/** A neutral identity transform (top-left anchor, no rotation/scale/flip) at the origin. */
export function defaultTransform( x : number, y : number, width : number, height : number ) : SvgDocument.Transform
{
    return {
        x, y, width, height, rotation: 0, scaleX: 1, scaleY: 1,
        flipH: false, flipV: false, anchor: SvgDocument.AnchorPoint.TOP_LEFT,
    };
}

/** A skeleton rectangle shape — the base for a freshly-added shape (the caller assigns a fresh id/transform). */
export const DEFAULT_SHAPE : SvgDocument.ShapeNode =
{
    id: "", kind: SvgDocument.ObjectKind.SHAPE, name: "Rectangle", locked: false, hidden: false,
    transform: defaultTransform( 0, 0, 120, 80 ), opacity: 1, conditionalVisibility: null,
    shapeType: SvgDocument.ShapeType.RECT, pathData: null,
    fill: { kind: "solid", color: DEFAULT_SHAPE_COLOR }, stroke: null, shadow: null,
    cornerRadius: 0, sides: 4, innerRadius: 0,
};

// ── Id + factory helpers ──────────────────────────────────────────────────────

/** Generate a short unique id (first 8 chars of a UUID) — for new pages/layers/objects. */
export function makeId() : string
{
    return globalThis.crypto.randomUUID().slice( 0, 8 );
}

/** Build a single empty default layer. */
export function makeBlankLayer() : SvgDocument.Layer
{
    return { id: makeId(), name: "Layer 1", locked: false, hidden: false, opacity: 1, objects: [] };
}

/** Build a blank page at the given preset size with one default layer. */
export function makeBlankPage( preset : SvgDocument.PagePreset ) : SvgDocument.Page
{
    const size : PresetSize = PAGE_PRESETS[ preset ];
    return {
        id: makeId(), name: "Page 1",
        size: { preset, width: size.width, height: size.height, unit: SvgDocument.Unit.PT, dpi: 72 },
        orientation: size.width > size.height ? SvgDocument.Orientation.LANDSCAPE : SvgDocument.Orientation.PORTRAIT,
        bleed: 0, safeArea: 0,
        background: { kind: "color", color: DEFAULT_BACKGROUND_COLOR, assetId: null },
        layers: [ makeBlankLayer() ], guides: [], grid: null,
    };
}

/** Build a blank document (one letter-size page) for a new project. */
export function makeBlankDoc( projectId : string ) : SvgDocument.Doc
{
    return {
        schemaVersion: SvgDocument.SCHEMA_VERSION, id: projectId,
        pages: [ makeBlankPage( SvgDocument.PagePreset.LETTER ) ], assets: [],
        styles: { textStyles: [], objectStyles: [], colorStyles: [], components: [] },
        variables: { fields: [], preview: {} },
        brand: null, plugins: [], exportSettings: { ...SvgDocument.DEFAULT_EXPORT_SETTINGS },
    };
}

// ── Fonts ─────────────────────────────────────────────────────────────────────

/** The top-50 Google Font families offered in the font picker (v1 typography scope). */
export const GOOGLE_FONTS_TOP_50 : Array<string> =
[
    "Roboto", "Open Sans", "Noto Sans", "Montserrat", "Lato", "Poppins", "Source Sans Pro", "Roboto Condensed",
    "Oswald", "Raleway", "Inter", "Nunito", "Ubuntu", "Roboto Mono", "Playfair Display", "Merriweather",
    "PT Sans", "Rubik", "Work Sans", "Noto Serif", "Roboto Slab", "Mukta", "Nunito Sans", "Quicksand",
    "Barlow", "Kanit", "Fira Sans", "Titillium Web", "Josefin Sans", "Dosis", "PT Serif", "Karla",
    "Libre Franklin", "Hind", "Manrope", "Heebo", "DM Sans", "Cabin", "Bebas Neue", "Anton",
    "Arvo", "Bitter", "Crimson Text", "Exo 2", "Abril Fatface", "Pacifico", "Comfortaa", "Lobster",
    "Dancing Script", "Caveat",
];

// ── Editor state + actions (reducer contract) ─────────────────────────────────

/** The bounded undo/redo ring of full-document snapshots (JSON snapshots per SVG_EDITOR_SPEC §6.5). */
export interface HistoryStack
{
    readonly past    : Array<SvgDocument.Doc>;
    readonly future  : Array<SvgDocument.Doc>;
    readonly maxSize : 100;
}

/** Which inspector detail level is shown (persisted per session). */
export type InspectorMode = "simple" | "advanced";

/** The editor's ephemeral state — the document model + selection/tool/zoom/history (never persisted as-is;
 *  the doc is what autosaves). Held by SvgDesignEditor via useReducer and shared through SvgEditorContext. */
export interface SvgEditorState
{
    readonly doc             : SvgDocument.Doc | null;
    readonly selectedIds     : Array<string>;        // Array (not Set) for serialization
    readonly hoveredId       : string | null;
    readonly activePage      : string;               // page id
    readonly activeLayer     : string;               // layer id
    readonly zoom            : number;                // 1 = 100%
    readonly panX            : number;
    readonly panY            : number;
    readonly tool            : ToolMode;
    readonly clipboard       : Array<SvgDocument.ObjectNode> | null;
    readonly history         : HistoryStack;
    readonly dirtyFlag       : boolean;
    readonly inspectorMode   : InspectorMode;
    readonly pluginPanelOpen : string | null;
}

/** The reducer action discriminant. */
export enum SvgEditorActionType
{
    LOAD_DOC           = "load_doc",
    SET_DOC            = "set_doc",
    UNDO               = "undo",
    REDO               = "redo",
    SELECT_OBJECTS     = "select_objects",
    CLEAR_SELECTION    = "clear_selection",
    SET_TOOL           = "set_tool",
    SET_ZOOM           = "set_zoom",
    SET_PAN            = "set_pan",
    SET_ACTIVE_PAGE    = "set_active_page",
    SET_ACTIVE_LAYER   = "set_active_layer",
    COPY               = "copy",
    PASTE              = "paste",
    CLEAR_DIRTY        = "clear_dirty",
    SET_INSPECTOR_MODE = "set_inspector_mode",
}

/** The discriminated union of every editor action the reducer handles. */
export type SvgEditorAction =
    | { type : SvgEditorActionType.LOAD_DOC;           doc : SvgDocument.Doc }
    | { type : SvgEditorActionType.SET_DOC;            doc : SvgDocument.Doc }
    | { type : SvgEditorActionType.UNDO }
    | { type : SvgEditorActionType.REDO }
    | { type : SvgEditorActionType.SELECT_OBJECTS;     ids : Array<string> }
    | { type : SvgEditorActionType.CLEAR_SELECTION }
    | { type : SvgEditorActionType.SET_TOOL;           tool : ToolMode }
    | { type : SvgEditorActionType.SET_ZOOM;           zoom : number }
    | { type : SvgEditorActionType.SET_PAN;            x : number; y : number }
    | { type : SvgEditorActionType.SET_ACTIVE_PAGE;    pageId : string }
    | { type : SvgEditorActionType.SET_ACTIVE_LAYER;   layerId : string }
    | { type : SvgEditorActionType.COPY }
    | { type : SvgEditorActionType.PASTE }
    | { type : SvgEditorActionType.CLEAR_DIRTY }
    | { type : SvgEditorActionType.SET_INSPECTOR_MODE; mode : InspectorMode };

/** The maximum number of undo snapshots kept in the history ring. */
export const HISTORY_MAX_SIZE : 100 = 100;

/** Build the editor's initial (empty) state — no doc loaded yet. */
export function makeInitialState() : SvgEditorState
{
    return {
        doc: null, selectedIds: [], hoveredId: null, activePage: "", activeLayer: "",
        zoom: 1, panX: 0, panY: 0, tool: ToolMode.SELECT, clipboard: null,
        history: { past: [], future: [], maxSize: HISTORY_MAX_SIZE },
        dirtyFlag: false, inspectorMode: "simple", pluginPanelOpen: null,
    };
}
