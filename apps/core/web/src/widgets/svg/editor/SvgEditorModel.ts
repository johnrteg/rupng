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
    SELECT = "select", TEXT = "text", SHAPE = "shape", ELLIPSE = "ellipse",
    LINE = "line_draw", POLYGON = "polygon_draw",
    BEZIER = "bezier_draw",
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
    { tool: ToolMode.SELECT,  label: "Select",    shortcut: "V" },
    { tool: ToolMode.TEXT,    label: "Text",      shortcut: "T" },
    { tool: ToolMode.SHAPE,   label: "Rectangle", shortcut: "R" },
    { tool: ToolMode.LINE,    label: "Line",      shortcut: "L" },
    { tool: ToolMode.PEN,     label: "Polyline",  shortcut: "P" },
    { tool: ToolMode.POLYGON, label: "Polygon",   shortcut: "O" },
    { tool: ToolMode.BEZIER,  label: "Bezier",    shortcut: "B" },
    { tool: ToolMode.IMAGE,   label: "Image",     shortcut: "I" },
    { tool: ToolMode.PAN,     label: "Pan",       shortcut: "Space" },
    { tool: ToolMode.ZOOM,    label: "Zoom",      shortcut: "Z" },
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

/** UI-only sentinel meaning "no named preset selected" — the document model represents this as
 *  `preset: null` (see {@link SvgDocument.PageSize}), never as a string; this exists only so preset
 *  pickers (a `SelectInput`, a card grid) have a concrete, comparable value for that state. */
export enum PagePresetOption
{
    CUSTOM = "custom",
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

/** Fallback document-level page size — US Letter portrait at 300 dpi, stored in points.
 *  Used when loading an older doc that pre-dates the doc-level pageSize field. */
export const DEFAULT_PAGE_SIZE : SvgDocument.PageSize =
{
    preset : SvgDocument.PagePreset.LETTER,
    width  : PAGE_PRESETS[ SvgDocument.PagePreset.LETTER ].width,
    height : PAGE_PRESETS[ SvgDocument.PagePreset.LETTER ].height,
    unit   : SvgDocument.Unit.INCHES,
    dpi    : 300,
};
/** The default text fill color (data, not chrome). */
const DEFAULT_TEXT_COLOR : string = "#111111";
/** The default shape fill color (data, not chrome). */
const DEFAULT_SHAPE_COLOR : string = "#3366ff";

/** A neutral default text style for a freshly-added text object. */
export const DEFAULT_TEXT_STYLE : SvgDocument.TextStyle =
{
    fontFamily: "Inter", fontWeight: 400, fontStyle: "normal", textDecoration: "none", fontSize: 16, color: DEFAULT_TEXT_COLOR,
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
    fill: { kind: SvgDocument.FillKind.SOLID, color: DEFAULT_SHAPE_COLOR }, stroke: null, shadow: null,
    cornerRadius: 0, sides: 4, innerRadius: 0,
};

/** The default stroke applied to a freshly-drawn line, polyline, or polygon. */
export const DEFAULT_LINE_STROKE : SvgDocument.Stroke = {
    color: "#111111", width: 2, dash: null, lineCap: "round", lineJoin: "round",
};

// ── Bezier path helpers ────────────────────────────────────────────────────────

/** One anchor point in a bezier path — position in local bbox coords + optional exit control-handle offset. */
export interface BezierAnchor
{
    readonly x      : number;           // anchor x in local (bounding-box) space
    readonly y      : number;           // anchor y in local (bounding-box) space
    readonly cpOutX : number | null;    // exit-control-handle x offset from anchor (null = corner)
    readonly cpOutY : number | null;    // exit-control-handle y offset from anchor
}

/** Auto-smooth corner anchors using Catmull-Rom tangent derivation so clicking (without dragging)
 *  produces curves rather than a polyline. Only anchors with cpOutX===null (unset) are updated;
 *  anchors where the user explicitly dragged to set a handle are left as-is.
 *  The LAST anchor is never auto-smoothed — its exit handle has no next neighbour to reference yet. */
export function catmullRomSmooth( anchors : Array<BezierAnchor> ) : Array<BezierAnchor>
{
    if( anchors.length < 2 ) return anchors;
    return anchors.map( ( anchor : BezierAnchor, index : number ) : BezierAnchor =>
    {
        // leave explicitly-dragged handles and the last anchor untouched
        if( anchor.cpOutX !== null ) return anchor;
        if( index === anchors.length - 1 ) return anchor;

        if( index === 0 )
        {
            // first anchor: tangent toward the second anchor (scaled to 1/3 of the chord)
            const next : BezierAnchor = anchors[ 1 ]!;
            return { ...anchor, cpOutX: ( next.x - anchor.x ) / 3, cpOutY: ( next.y - anchor.y ) / 3 };
        }

        // internal anchor: Catmull-Rom tangent = (next - prev) / 2, Bezier handle = tangent / 3
        const prev : BezierAnchor = anchors[ index - 1 ]!;
        const next : BezierAnchor = anchors[ index + 1 ]!;
        return { ...anchor, cpOutX: ( next.x - prev.x ) / 6, cpOutY: ( next.y - prev.y ) / 6 };
    } );
}

/** Build an SVG path `d` string from an array of bezier anchors (world-space coords during creation). */
export function buildBezierPathData( anchors : Array<BezierAnchor>, closed : boolean ) : string
{
    // need at least 2 points to form a segment
    if( anchors.length < 2 ) return "";
    const first : BezierAnchor = anchors[ 0 ];
    const parts : Array<string> = [ `M ${ first.x } ${ first.y }` ];
    for( let segIndex : number = 1; segIndex < anchors.length; segIndex++ )
    {
        const prev : BezierAnchor = anchors[ segIndex - 1 ];
        const curr : BezierAnchor = anchors[ segIndex ];
        const hasExit  : boolean = prev.cpOutX !== null && prev.cpOutY !== null;
        const hasEntry : boolean = curr.cpOutX !== null && curr.cpOutY !== null;
        if( !hasExit && !hasEntry )
        {
            // no handles on either side — straight line
            parts.push( `L ${ curr.x } ${ curr.y }` );
        }
        else
        {
            // cubic bezier: exit handle of prev as cp1, mirror of exit handle of curr as cp2
            const cp1x : number = hasExit  ? prev.x + ( prev.cpOutX ?? 0 ) : prev.x;
            const cp1y : number = hasExit  ? prev.y + ( prev.cpOutY ?? 0 ) : prev.y;
            const cp2x : number = hasEntry ? curr.x - ( curr.cpOutX ?? 0 ) : curr.x;
            const cp2y : number = hasEntry ? curr.y - ( curr.cpOutY ?? 0 ) : curr.y;
            parts.push( `C ${ cp1x } ${ cp1y } ${ cp2x } ${ cp2y } ${ curr.x } ${ curr.y }` );
        }
    }
    if( closed ) parts.push( "Z" );
    return parts.join( " " );
}

/** One parsed anchor point from an SVG path `d` string — for the bezier anchor-edit overlay.
 *  Control points are stored in LOCAL space (same coordinate system as the path itself). */
export interface PathAnchor
{
    x     : number;                                         // anchor position
    y     : number;
    cpIn  : { x : number; y : number } | null;             // incoming control point in local space (for C)
    cpOut : { x : number; y : number } | null;             // outgoing control point in local space (for C)
}

/** Parse an SVG path `d` string into PathAnchor records for the bezier editor.
 *  Handles M, L, C, Z (the subset this editor generates). */
export function parseBezierAnchors( d : string ) : Array<PathAnchor>
{
    // tokenise path by splitting on whitespace and before each command letter
    const raw : Array<string> = d.trim().split( /\s+/ );
    const tokens : Array<string> = [];
    for( const tok of raw )
    {
        const leading : RegExpMatchArray | null = tok.match( /^([MLCZmlcz])(.+)/ );
        if( leading !== null )
        {
            tokens.push( leading[ 1 ] ?? "" );
            if( ( leading[ 2 ] ?? "" ).length > 0 ) tokens.push( leading[ 2 ] ?? "" );
        }
        else
        {
            tokens.push( tok );
        }
    }

    const anchors : Array<PathAnchor> = [];
    let tokenIndex : number = 0;
    let curX : number = 0;
    let curY : number = 0;

    while( tokenIndex < tokens.length )
    {
        const cmd : string = tokens[ tokenIndex ] ?? "";
        tokenIndex++;

        if( cmd === "M" )
        {
            curX = parseFloat( tokens[ tokenIndex ] ?? "0" );
            tokenIndex++;
            curY = parseFloat( tokens[ tokenIndex ] ?? "0" );
            tokenIndex++;
            anchors.push( { x: curX, y: curY, cpIn: null, cpOut: null } );
        }
        else if( cmd === "L" )
        {
            curX = parseFloat( tokens[ tokenIndex ] ?? "0" );
            tokenIndex++;
            curY = parseFloat( tokens[ tokenIndex ] ?? "0" );
            tokenIndex++;
            anchors.push( { x: curX, y: curY, cpIn: null, cpOut: null } );
        }
        else if( cmd === "C" )
        {
            const cp1x : number = parseFloat( tokens[ tokenIndex ] ?? "0" );
            tokenIndex++;
            const cp1y : number = parseFloat( tokens[ tokenIndex ] ?? "0" );
            tokenIndex++;
            const cp2x : number = parseFloat( tokens[ tokenIndex ] ?? "0" );
            tokenIndex++;
            const cp2y : number = parseFloat( tokens[ tokenIndex ] ?? "0" );
            tokenIndex++;
            const ex   : number = parseFloat( tokens[ tokenIndex ] ?? "0" );
            tokenIndex++;
            const ey   : number = parseFloat( tokens[ tokenIndex ] ?? "0" );
            tokenIndex++;
            // cp1 is the exit handle of the previous anchor
            if( anchors.length > 0 )
            {
                const prev : PathAnchor = anchors[ anchors.length - 1 ];
                anchors[ anchors.length - 1 ] = { ...prev, cpOut: { x: cp1x, y: cp1y } };
            }
            // cp2 is the entry handle of the new anchor
            anchors.push( { x: ex, y: ey, cpIn: { x: cp2x, y: cp2y }, cpOut: null } );
            curX = ex;
            curY = ey;
        }
        else if( cmd === "Z" || cmd === "z" )
        {
            break;
        }
        // skip unknown commands
    }
    return anchors;
}

/** Rebuild an SVG path string from edited PathAnchors (used by the bezier anchor-edit overlay). */
export function rebuildPathFromAnchors( anchors : Array<PathAnchor>, closed : boolean ) : string
{
    if( anchors.length < 1 ) return "";
    const first : PathAnchor = anchors[ 0 ];
    const parts : Array<string> = [ `M ${ first.x } ${ first.y }` ];
    for( let segIdx : number = 1; segIdx < anchors.length; segIdx++ )
    {
        const prev : PathAnchor = anchors[ segIdx - 1 ];
        const curr : PathAnchor = anchors[ segIdx ];
        if( prev.cpOut !== null || curr.cpIn !== null )
        {
            const cp1x : number = prev.cpOut !== null ? prev.cpOut.x : prev.x;
            const cp1y : number = prev.cpOut !== null ? prev.cpOut.y : prev.y;
            const cp2x : number = curr.cpIn  !== null ? curr.cpIn.x  : curr.x;
            const cp2y : number = curr.cpIn  !== null ? curr.cpIn.y  : curr.y;
            parts.push( `C ${ cp1x } ${ cp1y } ${ cp2x } ${ cp2y } ${ curr.x } ${ curr.y }` );
        }
        else
        {
            parts.push( `L ${ curr.x } ${ curr.y }` );
        }
    }
    if( closed ) parts.push( "Z" );
    return parts.join( " " );
}

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

/** Build a blank document (one letter-size page at 300 dpi) for a new project. */
export function makeBlankDoc( projectId : string ) : SvgDocument.Doc
{
    // page.size must equal doc.pageSize from the start so both sources are always in sync
    const firstPage : SvgDocument.Page = { ...makeBlankPage( SvgDocument.PagePreset.LETTER ), size: DEFAULT_PAGE_SIZE };
    return {
        schemaVersion: SvgDocument.SCHEMA_VERSION, id: projectId,
        pageSize: DEFAULT_PAGE_SIZE,
        pages: [ firstPage ], assets: [],
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

// ── Document utilities ────────────────────────────────────────────────────────

/** Add a color to a seen set, skipping nulls, empty strings, and template variable refs ({{...}}). */
function addDocColor( seen : Set<string>, color : string | null | undefined ) : void
{
    if( color === null || color === undefined || color.trim() === "" ) return;
    if( color.startsWith( "{{" ) ) return;
    seen.add( color );
}

/** Collect colors from every span in a text node into the accumulator set. */
function collectTextNodeColors( seen : Set<string>, node : SvgDocument.TextNode ) : void
{
    node.content.forEach( ( span : SvgDocument.TextSpan ) : void =>
    {
        addDocColor( seen, span.style.color );
        addDocColor( seen, span.style.stroke?.color ?? null );
        addDocColor( seen, span.style.shadow?.color ?? null );
    } );
}

/** Collect colors from a fill value (solid color or gradient stops) into the accumulator set. */
function collectFillColors( seen : Set<string>, fill : SvgDocument.Fill ) : void
{
    if( fill.kind === SvgDocument.FillKind.SOLID )
    {
        addDocColor( seen, fill.color );
        return;
    }
    if( fill.kind === SvgDocument.FillKind.GRADIENT )
    {
        fill.gradient.stops.forEach( ( stop : SvgDocument.GradientStop ) : void => addDocColor( seen, stop.color ) );
    }
}

/** Collect colors from a shape node (fill + stroke + shadow) into the accumulator set. */
function collectShapeNodeColors( seen : Set<string>, node : SvgDocument.ShapeNode ) : void
{
    collectFillColors( seen, node.fill );
    addDocColor( seen, node.stroke?.color ?? null );
    addDocColor( seen, node.shadow?.color ?? null );
}

/** Collect colors from an arbitrary object node, recursing into groups. */
function collectObjectColors( seen : Set<string>, node : SvgDocument.ObjectNode ) : void
{
    if( node.kind === SvgDocument.ObjectKind.TEXT  ) collectTextNodeColors( seen, node );
    if( node.kind === SvgDocument.ObjectKind.SHAPE ) collectShapeNodeColors( seen, node );
    if( node.kind === SvgDocument.ObjectKind.GROUP )
    {
        node.objects.forEach( ( child : SvgDocument.ObjectNode ) : void => collectObjectColors( seen, child ) );
    }
}

/** Return all unique color strings used anywhere in a document — page backgrounds, text fills/strokes/shadows,
 *  shape fills (solid + gradient stops), shape strokes/shadows, and named color styles — in encounter order. */
export function collectDocColors( doc : SvgDocument.Doc ) : Array<string>
{
    const seen : Set<string> = new Set<string>();

    // named doc-level color styles
    doc.styles.colorStyles.forEach( ( named : SvgDocument.NamedColor ) : void => addDocColor( seen, named.value ) );

    // traverse every page → background + layers → objects
    doc.pages.forEach( ( page : SvgDocument.Page ) : void =>
    {
        if( page.background.kind === "color" ) addDocColor( seen, page.background.color );
        page.layers.forEach( ( layer : SvgDocument.Layer ) : void =>
        {
            layer.objects.forEach( ( node : SvgDocument.ObjectNode ) : void => collectObjectColors( seen, node ) );
        } );
    } );

    return Array.from( seen );
}

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
    readonly cropNodeId        : string | null;    // image node currently in crop-edit mode
    readonly editingNodeId     : string | null;    // text node currently in inline-edit mode (textarea overlay)
    readonly bezierEditNodeId  : string | null;    // PATH node currently in bezier anchor-edit mode
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
    SET_CROP_NODE      = "set_crop_node",
    UPDATE_DOC_LIVE    = "update_doc_live",    // update doc without creating an undo snapshot
    COMMIT_DOC         = "commit_doc",         // push a snapshot + set the final doc in one step
    ADD_PAGE           = "add_page",           // append a new page and switch to it
    SET_EDITING_NODE   = "set_editing_node",   // enter / exit inline text-edit mode (hides the SVG node)
    SET_BEZIER_EDIT    = "set_bezier_edit",    // enter / exit bezier anchor-edit mode on a PATH node
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
    | { type : SvgEditorActionType.SET_INSPECTOR_MODE; mode : InspectorMode }
    | { type : SvgEditorActionType.SET_CROP_NODE;      nodeId : string | null }
    | { type : SvgEditorActionType.UPDATE_DOC_LIVE;   doc : SvgDocument.Doc }
    | { type : SvgEditorActionType.COMMIT_DOC;        snapshot : SvgDocument.Doc; doc : SvgDocument.Doc }
    | { type : SvgEditorActionType.ADD_PAGE;          page : SvgDocument.Page }
    | { type : SvgEditorActionType.SET_EDITING_NODE;  nodeId : string | null }
    | { type : SvgEditorActionType.SET_BEZIER_EDIT;   nodeId : string | null };

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
        cropNodeId: null, editingNodeId: null, bezierEditNodeId: null,
    };
}
