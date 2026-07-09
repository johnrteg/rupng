//
// StudioProject — a Media Studio project: a named editing container of a media type (image / video / audio),
// belonging to a campaign, with free-form tags and (for image projects) a defined PAGE. The tldraw CANVAS
// snapshot is stored separately (S3, keyed by the project) — the record here is the lightweight metadata the
// project list shows. Owned by the media service (studio_projects table). Single source of truth for the
// page model, imported by the web editor (never re-declared at the call site).
//
import { Media } from "./Media";

export namespace StudioProject
{
    /** How a page's dimensions are expressed. Inches are physical (× DPI → pixels); pixels are absolute. */
    export enum PageUnit
    {
        INCHES = "in",
        PIXELS = "px",
    }

    /** A page definition — its size (in the chosen unit) and print density. Drives the on-canvas page frame
     *  and the saved/exported pixel dimensions (inches × DPI, or pixels verbatim). */
    export interface PageSpec
    {
        unit   : PageUnit;
        width  : number;
        height : number;
        dpi    : number;   // print density; converts inches → pixels (informational for pixel-sized pages)
    }

    /** The default page for a new image project (US Letter at web density). */
    export const DEFAULT_PAGE : PageSpec = { unit: PageUnit.INCHES, width: 8.5, height: 11, dpi: 72 };

    // ── Video projects ──────────────────────────────────────────────────────────────────────────
    // A VIDEO project's canvas is a VideoDoc (JSON): a timeline of scenes. The SAME shape drives the in-browser
    // Remotion <Player> preview AND the server-side ffmpeg render — defined once here so neither drifts.

    /** The kinds of scene / clip a video timeline is composed from. */
    export enum VideoSceneKind { IMAGE = "image", VIDEO = "video", TEXT = "text", AUDIO = "audio", SOLID = "solid", SHAPE = "shape" }

    /** A text OVERLAY on a scene, positioned RELATIVELY (normalized 0..1) so it reflows across aspect ratios
     *  when a destination variant is generated. `xPct`/`yPct` are the anchor point; `fontPct` is the font size
     *  as a fraction of the frame height; `align` is the horizontal text alignment about the anchor. */
    export interface VideoOverlay
    {
        id      : string;
        text    : string;
        xPct    : number;   // 0..1 (0 = left, 0.5 = center, 1 = right)
        yPct    : number;   // 0..1 (0 = top, 0.5 = middle, 1 = bottom)
        fontPct : number;   // font size as a fraction of frame height (e.g. 0.08)
        align   : "left" | "center" | "right";
        style?  : TextStyle;   // fill / outline / shadow / background / font styling
    }

    /** One scene on the video timeline. `src` is a (time-limited) preview URL; `assetGuid` is the DURABLE
     *  library-asset ref the server render resolves bytes from; `text` is a text-card body; `overlays` are
     *  relatively-positioned text layers drawn over the scene (reflow across formats). */
    export interface VideoScene
    {
        id          : string;
        kind        : VideoSceneKind;
        durationSec : number;
        src?        : string;
        assetGuid?  : string;
        name?       : string;
        text?       : string;
        overlays?   : Array<VideoOverlay>;
    }

    /** A TRACK (horizontal lane) on the timeline. Array order is TOP-to-bottom in the UI *and* paint order:
     *  a track EARLIER in the array renders ON TOP of the tracks after it (layer stack). */
    export interface TimelineTrack
    {
        id      : string;
        name    : string;
        muted?  : boolean;   // audio/video: silence this track's clips
        hidden? : boolean;   // exclude this track's clips from preview + render
    }

    /** A CLIP placed on a track at an ABSOLUTE start time. Clips on DIFFERENT tracks may overlap in time
     *  (they composite by track order); clips on the SAME track should not overlap. `trimStartSec` is the
     *  in-point into the source media. TEXT clips carry the same relative geometry as {@link VideoOverlay}. */
    export interface TimelineClip
    {
        id            : string;
        trackId       : string;
        kind          : VideoSceneKind;
        startSec      : number;         // absolute position on the timeline
        durationSec   : number;         // length on the timeline
        trimStartSec? : number;         // in-point into the source media (video/audio)
        sourceDurationSec? : number;    // the source media's natural length (video/audio) — a clip may be trimmed SHORTER but never stretched longer than (sourceDurationSec - trimStartSec)
        src?          : string;         // time-limited preview URL
        assetGuid?    : string;         // durable library-asset ref (server render resolves bytes from this)
        name?         : string;
        text?         : string;         // TEXT clip body
        color?        : string;         // SOLID clip fill color (hex); also a background card behind lower content
        shape?        : string;         // SHAPE clip: a SHAPE_LIBRARY key (rectangle / star / badge / …)
        shapeStyle?   : ShapeStyle;     // SHAPE clip: fill / stroke recolor
        xPct?         : number;         // TEXT: anchor x (0..1)
        yPct?         : number;         // TEXT: anchor y (0..1)
        fontPct?      : number;         // TEXT: font size as a fraction of frame height
        align?        : "left" | "center" | "right";
        style?        : TextStyle;      // TEXT: fill / outline / shadow / background / font styling
        animateIn?    : TextAnimateIn;  // TEXT: entry animation played over the clip's first `durationSec`
        transform?    : ClipTransform;  // IMAGE/VIDEO: position / scale / rotation / opacity / fit
        kenBurns?     : KenBurns;        // IMAGE/VIDEO: animated pan-zoom over the clip's duration
        filters?      : ClipFilters;     // IMAGE/VIDEO: color adjustments + grayscale / blur / vignette
        blend?        : BlendMode;       // IMAGE/VIDEO: how this layer composites over the ones beneath (preview-only fidelity)
        volume?       : number;         // audio/video volume (0..1)
        speed?        : number;         // VIDEO/AUDIO: playback rate (1 = normal, <1 slow-mo, >1 fast); source consumed = durationSec × speed
        reverse?      : boolean;        // VIDEO/AUDIO: play the source backwards (export-accurate; preview plays forward)
        loop?         : boolean;        // AUDIO: loop the source to fill the clip's timeline duration (background music)
        fadeInSec?    : number;         // simple fade/ramp IN over N seconds from the clip's start
        fadeOutSec?   : number;         // simple fade/ramp OUT over N seconds to the clip's end
        transitionIn? : Transition;     // a named transition INTO this clip from the one before it (overlaps by durationSec)
    }

    /** How a visual clip fits the frame: COVER fills it (cropping overflow), CONTAIN fits inside it (the
     *  surrounding shows the layers beneath / black). */
    export enum FitMode { COVER = "cover", CONTAIN = "contain" }

    /** A per-clip visual TRANSFORM for IMAGE/VIDEO layers. `xPct`/`yPct` offset the layer from center as a
     *  fraction of the frame (so it reflows across formats); `scale` zooms (1 = base fit); `rotation` is in
     *  degrees; `opacity` is 0..1; `fit` is the frame-fit mode. All optional — unset = identity, cover fit. */
    export interface ClipTransform
    {
        xPct?     : number;
        yPct?     : number;
        scale?    : number;
        rotation? : number;
        opacity?  : number;
        fit?      : FitMode;
    }

    /** A KEN BURNS pan/zoom for a (usually still) visual clip: the scale + center offset are linearly
     *  interpolated from the `from` state to the `to` state across the clip's duration. Offsets are fractions
     *  of the frame. Preview animates it faithfully; the export applies a static midpoint zoom (see SPECS). */
    export interface KenBurns
    {
        fromScale : number; toScale : number;
        fromXPct  : number; toXPct  : number;
        fromYPct  : number; toYPct  : number;
    }

    /** The identity transform (centered, unscaled, opaque, cover) — seeds a clip's transform controls. */
    export const DEFAULT_CLIP_TRANSFORM : ClipTransform =
        { xPct: 0, yPct: 0, scale: 1, rotation: 0, opacity: 1, fit: FitMode.COVER };

    /** Per-clip color EFFECTS / FILTERS for IMAGE/VIDEO layers. Neutral values leave the image untouched:
     *  `brightness` -1..1 (0), `contrast`/`saturation` 0..2 (1); `grayscale` desaturates fully; `blur` 0..1
     *  (fraction of {@link FILTER_BLUR_MAX}); `vignette` darkens the edges. Maps to CSS `filter` in the preview
     *  and to ffmpeg `eq`/`gblur`/`vignette` in the render. */
    export interface ClipFilters
    {
        brightness? : number;
        contrast?   : number;
        saturation? : number;
        grayscale?  : boolean;
        blur?       : number;
        vignette?   : boolean;
    }

    /** The neutral (no-op) filter set — seeds a clip's effect controls. */
    export const DEFAULT_CLIP_FILTERS : ClipFilters =
        { brightness: 0, contrast: 1, saturation: 1, grayscale: false, blur: 0, vignette: false };

    /** How a visual layer BLENDS over the layers beneath it (CSS `mix-blend-mode` values). A closed set → enum.
     *  Preview-only fidelity: the ffmpeg overlay graph composites `normal`; other modes render as normal. */
    export enum BlendMode
    {
        NORMAL   = "normal",
        MULTIPLY = "multiply",
        SCREEN   = "screen",
        OVERLAY  = "overlay",
        DARKEN   = "darken",
        LIGHTEN  = "lighten",
        DIFFERENCE = "difference",
    }

    /** The pixel radius `blur` = 1 maps to (CSS `blur(px)` and ffmpeg `gblur=sigma`), so preview and render match. */
    export const FILTER_BLUR_MAX : number = 20;

    /** Recolor for a SHAPE (SVG) overlay — a fill, and an optional stroke (color + width in the shape's 0..100
     *  viewBox units). Applied by {@link buildShapeSvg} to the library shape. Geometry (position / scale /
     *  rotation / opacity) comes from the clip's {@link ClipTransform}, not here. */
    export interface ShapeStyle { fill? : string; stroke? : string; strokeWidth? : number; }

    /** The neutral shape style (white fill, no stroke). */
    export const DEFAULT_SHAPE_STYLE : ShapeStyle = { fill: "#ffffff", stroke: "#000000", strokeWidth: 0 };

    /** One built-in SVG shape: a stable `key`, a display `label`, its `viewBox`, and the inner markup `body`
     *  (fill/stroke are injected by {@link buildShapeSvg}, so author bodies WITHOUT them). */
    export interface ShapeDef { key : string; label : string; viewBox : string; body : string; }

    /** The built-in SVG SHAPE library (media-21.32) — parametric geometry + badges/callouts. One mechanism drives
     *  both simple shapes and richer objects; account-uploaded SVGs can extend this later. All 0..100 viewBox. */
    export const SHAPE_LIBRARY : Array<ShapeDef> =
    [
        { key: "rectangle", label: "Rectangle",     viewBox: "0 0 100 100", body: `<rect x="4" y="4" width="92" height="92"/>` },
        { key: "rounded",   label: "Rounded rect",  viewBox: "0 0 100 100", body: `<rect x="4" y="4" width="92" height="92" rx="14"/>` },
        { key: "circle",    label: "Circle",        viewBox: "0 0 100 100", body: `<circle cx="50" cy="50" r="46"/>` },
        { key: "triangle",  label: "Triangle",      viewBox: "0 0 100 100", body: `<polygon points="50,6 94,94 6,94"/>` },
        { key: "diamond",   label: "Diamond",       viewBox: "0 0 100 100", body: `<polygon points="50,4 96,50 50,96 4,50"/>` },
        { key: "hexagon",   label: "Hexagon",       viewBox: "0 0 100 100", body: `<polygon points="25,8 75,8 96,50 75,92 25,92 4,50"/>` },
        { key: "pentagon",  label: "Pentagon",      viewBox: "0 0 100 100", body: `<polygon points="50,5 95,39 78,94 22,94 5,39"/>` },
        { key: "star",      label: "Star",          viewBox: "0 0 100 100", body: `<polygon points="50,5 61,38 96,38 67,59 78,94 50,72 22,94 33,59 4,38 39,38"/>` },
        { key: "badge",     label: "Badge",         viewBox: "0 0 100 100", body: `<polygon points="50,3 60,15 76,11 78,27 94,33 86,47 96,60 82,68 82,84 66,82 56,95 44,82 34,88 30,72 14,70 18,54 6,44 20,34 18,18 34,20 42,7"/>` },
        { key: "heart",     label: "Heart",         viewBox: "0 0 100 100", body: `<path d="M50,88 C10,55 20,15 50,38 C80,15 90,55 50,88 Z"/>` },
        { key: "arrow",     label: "Arrow",         viewBox: "0 0 100 100", body: `<polygon points="6,38 60,38 60,18 96,50 60,82 60,62 6,62"/>` },
        { key: "bubble",    label: "Speech bubble", viewBox: "0 0 100 100", body: `<path d="M8,10 h84 a6,6 0 0 1 6,6 v46 a6,6 0 0 1 -6,6 h-46 l-22,18 v-18 h-10 a6,6 0 0 1 -6,-6 v-46 a6,6 0 0 1 6,-6 z"/>` },
    ];

    /** Build a complete, self-contained SVG string for a library shape with the fill/stroke recolor applied —
     *  used BOTH by the preview (as a data-URI `<img>`) and the render (rasterized to PNG via sharp), so preview
     *  and export match. `preserveAspectRatio` keeps the shape undistorted; geometry is the clip transform. */
    export function buildShapeSvg( shape : string | undefined, style : ShapeStyle | undefined ) : string
    {
        const definition : ShapeDef = SHAPE_LIBRARY.find( ( entry : ShapeDef ) : boolean => entry.key === shape ) ?? SHAPE_LIBRARY[ 0 ];
        const fill : string = style?.fill ?? "#ffffff";
        const strokeWidth : number = style?.strokeWidth ?? 0;
        const stroke : string = strokeWidth > 0 && style?.stroke !== undefined ? style.stroke : "none";
        return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${ definition.viewBox }" preserveAspectRatio="xMidYMid meet"><g fill="${ fill }" stroke="${ stroke }" stroke-width="${ strokeWidth }" stroke-linejoin="round">${ definition.body }</g></svg>`;
    }

    /** A named Ken Burns preset the inspector offers (zoom in/out + slow pans, all starting slightly zoomed so
     *  a pan has room to move without revealing the frame edge). */
    export interface KenBurnsPreset { key : string; label : string; value : KenBurns; }
    export const KEN_BURNS_PRESETS : Array<KenBurnsPreset> =
    [
        { key: "zoom-in",    label: "Zoom in",    value: { fromScale: 1.0, toScale: 1.2, fromXPct: 0,     toXPct: 0,    fromYPct: 0,     toYPct: 0 } },
        { key: "zoom-out",   label: "Zoom out",   value: { fromScale: 1.2, toScale: 1.0, fromXPct: 0,     toXPct: 0,    fromYPct: 0,     toYPct: 0 } },
        { key: "pan-right",  label: "Pan right",  value: { fromScale: 1.15, toScale: 1.15, fromXPct: -0.06, toXPct: 0.06, fromYPct: 0,   toYPct: 0 } },
        { key: "pan-left",   label: "Pan left",   value: { fromScale: 1.15, toScale: 1.15, fromXPct: 0.06,  toXPct: -0.06, fromYPct: 0,  toYPct: 0 } },
        { key: "pan-up",     label: "Pan up",     value: { fromScale: 1.15, toScale: 1.15, fromXPct: 0,     toXPct: 0,    fromYPct: 0.06,  toYPct: -0.06 } },
        { key: "pan-down",   label: "Pan down",   value: { fromScale: 1.15, toScale: 1.15, fromXPct: 0,     toXPct: 0,    fromYPct: -0.06, toYPct: 0.06 } },
    ];

    /** The animated transitions a clip can enter with (over its previous clip). */
    export enum TransitionType
    {
        DISSOLVE   = "dissolve",       // cross-dissolve (opacity)
        WIPE_LEFT  = "wipe-left",      // reveal right→left
        WIPE_RIGHT = "wipe-right",     // reveal left→right
        WIPE_UP    = "wipe-up",        // reveal bottom→top
        WIPE_DOWN  = "wipe-down",      // reveal top→bottom
        SLIDE_LEFT  = "slide-left",    // incoming slides in from the right
        SLIDE_RIGHT = "slide-right",   // incoming slides in from the left
        SLIDE_UP    = "slide-up",      // incoming slides in from below
        SLIDE_DOWN  = "slide-down",    // incoming slides in from above
    }

    /** A transition INTO a clip: its kind + how long it runs (it overlaps the preceding clip by this long). */
    export interface Transition { type : TransitionType; durationSec : number; }

    /** Which corner of the frame a {@link Watermark} anchors to. */
    export enum WatermarkCorner
    {
        TOP_LEFT     = "top-left",
        TOP_RIGHT    = "top-right",
        BOTTOM_LEFT  = "bottom-left",
        BOTTOM_RIGHT = "bottom-right",
    }

    /** A persistent logo / watermark burned over the WHOLE timeline (a library IMAGE asset). `src` is a
     *  time-limited preview URL the editor resolves; `assetGuid` is the DURABLE ref the render resolves bytes
     *  from. `scalePct` is its width as a fraction of the frame width, `marginPct` the inset from the edges
     *  (both fractions so it scales across destination formats); `opacity` is 0..1. */
    export interface Watermark
    {
        assetGuid : string;
        src?      : string;
        corner    : WatermarkCorner;
        scalePct  : number;
        opacity   : number;
        marginPct : number;
    }

    /** The default watermark PLACEMENT (bottom-right, 15% width, 80% opaque, 3% margin) — the identity field
     *  `assetGuid` is omitted (a watermark without an asset is nothing to render); merged with the picked asset. */
    export const DEFAULT_WATERMARK : Omit<Watermark, "assetGuid" | "src"> =
        { corner: WatermarkCorner.BOTTOM_RIGHT, scalePct: 0.15, opacity: 0.8, marginPct: 0.03 };

    /** The video document — a TRACK/CLIP timeline (multi-track, time-overlapping) + master output format +
     *  the destination formats to auto-generate as variants (persisted as the project's canvas JSON). The
     *  legacy sequential `scenes` field is retained for older docs and migrated on load ({@link migrateToTimeline}). */
    export interface VideoDoc
    {
        scenes?    : Array<VideoScene>;       // LEGACY sequential model — migrated to tracks/clips on load
        tracks?    : Array<TimelineTrack>;
        clips?     : Array<TimelineClip>;
        fps        : number;
        width      : number;
        height     : number;
        targets?   : Array<string>;   // destination VideoFormat keys to auto-render as variants (empty/undef = master only)
        watermark? : Watermark;       // a logo/watermark burned over the whole timeline (top-most)
        quality?   : VideoQuality;    // export encode quality (crf/preset); default STANDARD
        bitrateKbps? : number;        // explicit target video bitrate (kbps); 0/undef = CRF (quality-based) encode
        posterSec? : number;          // export: extract this frame time (s) as the POSTER/thumbnail image
        gif?       : boolean;         // export: also produce an animated GIF of the master render
    }

    /** Export encode QUALITY — trades render time + file size for visual quality (maps to an x264 crf + preset).
     *  A small closed set → enum, not a free string. Export-only (no preview effect). */
    export enum VideoQuality { DRAFT = "draft", STANDARD = "standard", HIGH = "high" }

    /** The x264 encode settings each {@link VideoQuality} maps to (lower crf = higher quality/bigger; slower
     *  preset = better compression). Consumed by the ffmpeg render's output options. */
    export const VIDEO_QUALITY : Record<VideoQuality, { crf : number; preset : string }> =
    {
        [ VideoQuality.DRAFT ]:    { crf: 30, preset: "veryfast" },   // fast, small, rough — previews / iteration
        [ VideoQuality.STANDARD ]: { crf: 23, preset: "medium" },     // balanced default
        [ VideoQuality.HIGH ]:     { crf: 18, preset: "slow" },       // best quality, larger + slower
    };

    /** The starting tracks for a new video document (overlays layered above the base video track). */
    export const DEFAULT_VIDEO_TRACKS : Array<TimelineTrack> =
    [
        { id: "track-overlay", name: "Overlays" },
        { id: "track-video",   name: "Video" },
    ];

    /** A blank 1080p / 30fps video document (one overlay track over one video track, no clips yet). */
    export const DEFAULT_VIDEO_DOC : VideoDoc =
    {
        scenes: [], clips: [],
        tracks: DEFAULT_VIDEO_TRACKS.map( ( track : TimelineTrack ) : TimelineTrack => ( { ...track } ) ),
        fps: 30, width: 1920, height: 1080,
    };

    /** Default relative geometry for a text clip / overlay (centered, lower-third, 8% font). */
    export const DEFAULT_TEXT_GEOMETRY : { xPct : number; yPct : number; fontPct : number; align : "center" } =
        { xPct: 0.5, yPct: 0.88, fontPct: 0.08, align: "center" };

    /** The font FAMILY a text layer uses. The preview renders the matching CSS stack; the server render
     *  currently draws with its single bundled font, so family (and bold) are PREVIEW-fidelity until the
     *  render bundles matching font files. A small, nameable closed set — hence an enum, not a free string. */
    export enum TextFont
    {
        SANS  = "sans-serif",
        SERIF = "serif",
        MONO  = "monospace",
    }

    /** A text OUTLINE (stroke): a color and a width as a fraction of the font size (so it scales with the
     *  text across destination formats). Maps to drawtext `bordercolor` + `borderw` in the render. */
    export interface TextOutline { color : string; widthPct : number; }

    /** A text BACKGROUND box (lower-third style): a color, its opacity (0..1), and padding as a fraction of the
     *  font size. Maps to drawtext `box=1:boxcolor=color@opacity:boxborderw` in the render. */
    export interface TextBackground { color : string; opacity : number; padPct : number; }

    /** Visual STYLING for a TEXT clip / overlay. Colors here are free-form CONTENT values (hex) chosen by the
     *  user — NOT app theme tokens. `color` (fill), `outline`, `shadow`, and `background` all map to ffmpeg
     *  drawtext options so preview and render match; `fontFamily`/`bold` are preview-fidelity (see {@link TextFont}). */
    export interface TextStyle
    {
        fontFamily? : TextFont;         // preview CSS stack; render uses its bundled font
        bold?       : boolean;          // preview weight; render uses its bundled font
        color?      : string;           // fill color (hex) — default white
        outline?    : TextOutline;      // stroke around the glyphs
        shadow?     : boolean;          // drop shadow (default true — matches the legacy look)
        background? : TextBackground;   // filled box behind the text
    }

    /** The safe baseline text style (white fill, drop shadow, sans-serif, bold) — matches the pre-styling look
     *  so existing text clips render unchanged, and seeds a newly-added text clip. */
    export const DEFAULT_TEXT_STYLE : TextStyle =
        { fontFamily: TextFont.SANS, bold: true, color: "#ffffff", shadow: true };

    /** The entry ANIMATION a TEXT layer plays as it appears (over its first `durationSec`). Distinct from a
     *  clip {@link Transition} (which overlaps the PREVIOUS clip): this animates the text itself IN, in place.
     *  Preview renders each faithfully; the server render approximates slide/pop/typewriter as a fade-in. */
    export enum TextAnimation
    {
        FADE        = "fade",         // opacity ramp in
        TYPEWRITER  = "typewriter",   // characters revealed left→right over the duration
        SLIDE_LEFT  = "slide-left",   // slides in from the right, settling left
        SLIDE_RIGHT = "slide-right",  // slides in from the left, settling right
        SLIDE_UP    = "slide-up",     // rises in from below
        SLIDE_DOWN  = "slide-down",   // drops in from above
        POP         = "pop",          // scales up from small with a fade
    }

    /** A text entry animation: its kind + how long it plays from the clip's start. */
    export interface TextAnimateIn { type : TextAnimation; durationSec : number; }

    /** A pre-built text LAYOUT the user can drop in (a title card, lower-third, caption bar). */
    export enum TextTemplate
    {
        TITLE          = "title",           // one big centered title
        TITLE_SUBTITLE = "title-subtitle",  // centered title + smaller subtitle
        LOWER_THIRD    = "lower-third",      // name + subtitle in a boxed lower-left third
        CAPTION        = "caption",          // a single boxed caption bar, bottom-center
    }

    /** One text layer of a {@link TextTemplateDef} — relative geometry + baseline style + placeholder text.
     *  The editor materializes each into a TEXT {@link TimelineClip} at the playhead. */
    export interface TextTemplateLayer
    {
        text    : string;
        xPct    : number;
        yPct    : number;
        fontPct : number;
        align   : "left" | "center" | "right";
        style   : TextStyle;
    }

    /** A named text template: its label + the one-or-more text layers it drops in. */
    export interface TextTemplateDef { template : TextTemplate; label : string; layers : Array<TextTemplateLayer>; }

    /** A boxed caption/lower-third background (translucent black behind the text) reused across templates + auto-captions. */
    const TEXT_BOX_BACKGROUND : TextBackground = { color: "#000000", opacity: 0.5, padPct: 0.35 };

    /** The built-in text templates (title / title+subtitle / lower-third / caption bar). Colors/geometry are
     *  relative so a template reflows across destination formats; each layer seeds a normal editable text clip. */
    export const TEXT_TEMPLATES : Array<TextTemplateDef> =
    [
        { template: TextTemplate.TITLE, label: "Title", layers:
            [ { text: "Title", xPct: 0.5, yPct: 0.44, fontPct: 0.12, align: "center", style: { ...DEFAULT_TEXT_STYLE, bold: true } } ] },
        { template: TextTemplate.TITLE_SUBTITLE, label: "Title + subtitle", layers:
            [ { text: "Title",    xPct: 0.5, yPct: 0.42, fontPct: 0.12, align: "center", style: { ...DEFAULT_TEXT_STYLE, bold: true } },
              { text: "Subtitle", xPct: 0.5, yPct: 0.56, fontPct: 0.05, align: "center", style: { ...DEFAULT_TEXT_STYLE, bold: false } } ] },
        { template: TextTemplate.LOWER_THIRD, label: "Lower third", layers:
            [ { text: "Name",     xPct: 0.08, yPct: 0.78, fontPct: 0.06,  align: "left", style: { ...DEFAULT_TEXT_STYLE, bold: true,  background: { ...TEXT_BOX_BACKGROUND } } },
              { text: "Subtitle", xPct: 0.08, yPct: 0.86, fontPct: 0.035, align: "left", style: { ...DEFAULT_TEXT_STYLE, bold: false, background: { ...TEXT_BOX_BACKGROUND } } } ] },
        { template: TextTemplate.CAPTION, label: "Caption bar", layers:
            [ { text: "Caption", xPct: 0.5, yPct: 0.9, fontPct: 0.045, align: "center", style: { ...DEFAULT_TEXT_STYLE, bold: true, background: { color: "#000000", opacity: 0.6, padPct: 0.4 } } } ] },
    ];

    /** The style + relative geometry an AUTO-CAPTION line uses (bottom-center boxed caption). Kept here so the
     *  caption generator and the "Caption bar" template stay visually consistent. */
    export const CAPTION_GEOMETRY : { xPct : number; yPct : number; fontPct : number; align : "center" } =
        { xPct: 0.5, yPct: 0.9, fontPct: 0.045, align: "center" };
    export const CAPTION_STYLE : TextStyle =
        { ...DEFAULT_TEXT_STYLE, bold: true, background: { color: "#000000", opacity: 0.6, padPct: 0.4 } };

    /** The timeline's total length in seconds (the furthest clip end), min 0.1s so a Player always has a
     *  valid duration. */
    export function timelineDurationSec( doc : VideoDoc ) : number
    {
        const clips : Array<TimelineClip> = doc.clips ?? [];
        const end : number = clips.reduce( ( max : number, clip : TimelineClip ) : number => Math.max( max, clip.startSec + clip.durationSec ), 0 );
        return Math.max( 0.1, end );
    }

    /** Ensure a doc has at least the default tracks (older/partial docs), preserving any it already has. */
    function withDefaultTracks( doc : VideoDoc ) : VideoDoc
    {
        if( doc.tracks !== undefined && doc.tracks.length > 0 ) return doc;
        return { ...doc, tracks: DEFAULT_VIDEO_TRACKS.map( ( track : TimelineTrack ) : TimelineTrack => ( { ...track } ) ) };
    }

    /** Migrate a legacy scene-list doc to the track/clip TIMELINE model (idempotent — a doc that already has
     *  clips is returned unchanged, only ensuring default tracks). Scenes lay end-to-end on the VIDEO track;
     *  each scene's overlays become TEXT clips on the OVERLAY track spanning that scene's time. */
    export function migrateToTimeline( doc : VideoDoc ) : VideoDoc
    {
        if( ( doc.clips !== undefined && doc.clips.length > 0 ) || doc.scenes === undefined || doc.scenes.length === 0 ) return withDefaultTracks( doc );

        // convert each sequential scene → a base clip on the video track, its overlays → text clips above it
        const clips : Array<TimelineClip> = [];
        let cursor : number = 0;
        for( const scene of doc.scenes )
        {
            clips.push( { id: `clip-${ scene.id }`, trackId: "track-video", kind: scene.kind, startSec: cursor, durationSec: scene.durationSec, src: scene.src, assetGuid: scene.assetGuid, name: scene.name, text: scene.text } );
            for( const overlay of scene.overlays ?? [] )
                clips.push( { id: `clip-${ overlay.id }`, trackId: "track-overlay", kind: VideoSceneKind.TEXT, startSec: cursor, durationSec: scene.durationSec, text: overlay.text, xPct: overlay.xPct, yPct: overlay.yPct, fontPct: overlay.fontPct, align: overlay.align, style: overlay.style } );
            cursor += scene.durationSec;
        }
        return { ...withDefaultTracks( doc ), clips };
    }

    /** Best-effort bridge for the SEQUENTIAL ffmpeg render: collapse a timeline back to an ordered scene list.
     *  The IMAGE/VIDEO clips (ordered by start) become the scenes; each TEXT clip that overlaps a base clip in
     *  time becomes that scene's overlay. NOTE: true multi-track compositing / time-overlapping base clips are
     *  NOT preserved (that needs a compositing renderer) — this keeps a usable master render from a timeline. */
    export function flattenTimelineToScenes( doc : VideoDoc ) : Array<VideoScene>
    {
        if( doc.clips === undefined || doc.clips.length === 0 ) return doc.scenes ?? [];
        const base : Array<TimelineClip> = doc.clips
            .filter( ( clip : TimelineClip ) : boolean => clip.kind === VideoSceneKind.IMAGE || clip.kind === VideoSceneKind.VIDEO )
            .sort( ( left : TimelineClip, right : TimelineClip ) : number => left.startSec - right.startSec );
        const texts : Array<TimelineClip> = doc.clips.filter( ( clip : TimelineClip ) : boolean => clip.kind === VideoSceneKind.TEXT );

        // each base clip → a scene; text clips overlapping it in time (with geometry) → its overlays
        return base.map( ( clip : TimelineClip ) : VideoScene =>
        {
            const overlays : Array<VideoOverlay> = texts
                .filter( ( text : TimelineClip ) : boolean => text.startSec < clip.startSec + clip.durationSec && text.startSec + text.durationSec > clip.startSec )
                .map( ( text : TimelineClip ) : VideoOverlay => ( { id: text.id, text: text.text ?? "", xPct: text.xPct ?? DEFAULT_TEXT_GEOMETRY.xPct, yPct: text.yPct ?? DEFAULT_TEXT_GEOMETRY.yPct, fontPct: text.fontPct ?? DEFAULT_TEXT_GEOMETRY.fontPct, align: text.align ?? DEFAULT_TEXT_GEOMETRY.align, style: text.style } ) );
            return { id: clip.id, kind: clip.kind, durationSec: clip.durationSec, src: clip.src, assetGuid: clip.assetGuid, name: clip.name, text: clip.text, overlays };
        } );
    }

    /** A destination video FORMAT (aspect ratio + pixel size) — YouTube, Reels/TikTok, feed square, etc. The
     *  master doc is authored in one format; other destinations are auto-generated as VARIANTS by re-framing
     *  the media and reflowing the (relatively-positioned) overlays. */
    export interface VideoFormat { key : string; label : string; width : number; height : number; }

    /** Common destination formats. `key` doubles as the variant profile id. */
    export const VIDEO_FORMATS : Array<VideoFormat> =
    [
        { key: "youtube",        label: "YouTube (16:9) — 1920 × 1080",        width: 1920, height: 1080 },
        { key: "youtube_shorts", label: "YouTube Shorts (9:16) — 1080 × 1920", width: 1080, height: 1920 },
        { key: "instagram_post", label: "Instagram Post (1:1) — 1080 × 1080",  width: 1080, height: 1080 },
        { key: "instagram_reel", label: "Instagram Reel / Story (9:16) — 1080 × 1920", width: 1080, height: 1920 },
        { key: "instagram_43",   label: "Instagram Portrait (4:5) — 1080 × 1350",       width: 1080, height: 1350 },
        { key: "tiktok",         label: "TikTok (9:16) — 1080 × 1920",         width: 1080, height: 1920 },
        { key: "facebook_feed",  label: "Facebook Feed (4:5) — 1080 × 1350",   width: 1080, height: 1350 },
        { key: "x_post",         label: "X / Twitter (16:9) — 1280 × 720",     width: 1280, height: 720 },
    ];

    /** The format whose dimensions match a doc (or undefined for a custom size). */
    export function videoFormatFor( doc : VideoDoc ) : VideoFormat | undefined
    {
        return VIDEO_FORMATS.find( ( format : VideoFormat ) : boolean => format.width === doc.width && format.height === doc.height );
    }

    /** A Studio project (the persisted record). `id` is the project guid; `accountId` partitions the table. */
    export interface Entity
    {
        accountId       : string;
        id              : string;
        name            : string;
        kind            : Media.Kind;         // image | video | audio
        campaignId?     : string;             // the campaign this project belongs to (empty = unassigned)
        tags            : Array<string>;
        libraryAssetId? : string;             // the library asset this project saves its composite to (update-in-place)
        page            : PageSpec;           // the page/doc size + density (image projects)
        createdAt       : string;
        modifiedAt      : string;
        createdBy?      : string;             // acting user id/email at create
        modifiedBy?     : string;             // acting user id/email at last change
    }
}

export default StudioProject;
