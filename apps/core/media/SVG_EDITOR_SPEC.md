# SVG Design Editor — Technical Specification (v1)

> **Scope:** Browser-based professional SVG design editor, integrated into the existing
> media/Studio infrastructure. Beginner-friendly on the surface; full vector precision
> underneath. No AI generation features in this spec — those layer on top independently.

---

## Table of Contents

1. [Guiding Principles](#1-guiding-principles)
2. [Relationship to Existing Studio](#2-relationship-to-existing-studio)
3. [Document Model (JSON)](#3-document-model-json)
4. [Object Model](#4-object-model)
5. [Plugin Architecture](#5-plugin-architecture)
6. [Canvas & Rendering](#6-canvas--rendering)
7. [Document Storage & Versioning](#7-document-storage--versioning)
8. [API Contracts](#8-api-contracts)
9. [Web UI Architecture](#9-web-ui-architecture)
10. [Export Pipeline](#10-export-pipeline)
11. [Brand Assets](#11-brand-assets)
12. [Typography](#12-typography)
13. [Color System](#13-color-system)
14. [Variables / Merge Fields](#14-variables--merge-fields)
15. [Print Features](#15-print-features)
16. [Templates](#16-templates)
17. [Editing Operations & Keyboard Shortcuts](#17-editing-operations--keyboard-shortcuts)
18. [Precision Controls](#18-precision-controls)
19. [Layers & Z-Order](#19-layers--z-order)
20. [Alignment & Distribution](#20-alignment--distribution)
21. [Advanced SVG Editing](#21-advanced-svg-editing)
22. [Perspective Objects (v2)](#22-perspective-objects-v2)
23. [Generated Components](#23-generated-components)
24. [Phase Breakdown](#24-phase-breakdown)
25. [Open Questions](#25-open-questions)

---

## 1. Guiding Principles

| Principle | What it means in practice |
|---|---|
| **SVG is the native format** | The canvas renders real SVG; the document compiles to SVG losslessly |
| **JSON is the editable model** | Users save/load the JSON doc, never raw SVG; SVG is a view/export of it |
| **Everything stays editable** | No operations destructively flatten — flatten is an explicit user choice |
| **Progressive disclosure** | Simple panels by default; advanced controls revealed on demand |
| **Plugin-first architecture** | QR codes, barcodes, charts, print preflight, and future AI all live as plugins |
| **Print-ready** | Bleed, safe area, crop marks, CMYK export are first-class, not afterthoughts |
| **Beginner-safe** | Undo is always available; no destructive default; meaningful tool-tips everywhere |
| **Single source of truth for models** | All types live in `@repo/api`; no parallel re-declarations at call sites |

---

## 2. Relationship to Existing Studio

The media service already has a Studio concept (`GetStudioProjectsImpl`, `PutStudioCanvasImpl`, `PostStudioRenderImpl`, `MediaStudioService`). The SVG editor **extends** that foundation rather than duplicating it.

```
Existing Studio model        SVG Editor extension
────────────────────         ──────────────────────────────
StudioProject                SvgProject (extends StudioProject, kind = "svg")
canvas (DynamoDB blob)  →    SvgDocument stored in S3; DynamoDB row holds canvasKey (S3 key)
PostStudioRenderImpl    →    Render pipeline: SvgDocument → SVG → PNG/PDF (Puppeteer)
```

- **`SvgProject`** adds `kind: "svg"` to the existing `StudioProject` model and replaces the `canvas` blob with a `canvasKey` S3 reference.
- The existing `GetStudioProjects`, `PostStudioProject`, `PatchStudioProject`, `DeleteStudioProject` endpoints are reused with `kind` filtering.
- **New** endpoints cover SVG-specific concerns: canvas load/save (S3-backed, typed), render/export, template management, plugin execution.

---

## 3. Document Model (JSON)

The canonical editable representation. Stored as a JSON file in S3 (`svg-docs/{accountId}/{projectId}.json`). DynamoDB holds only metadata + the S3 key. Document versioning is handled by S3 object versioning — no version counter lives inside the doc itself. `SCHEMA_VERSION` is the only version field and exists solely for future migration of the JSON shape.

```typescript
// packages/api/src/media/model/SvgDocument.ts

export namespace SvgDocument
{
    // ── Top-level document ──────────────────────────────────────────────────

    export interface Doc
    {
        readonly schemaVersion  : number;               // incremented only on breaking JSON shape change; not a save counter
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

    export interface PageSize
    {
        readonly preset : PagePreset | null;            // null = custom
        readonly width  : number;                       // in points (1pt = 1/72 in)
        readonly height : number;
        readonly unit   : Unit;                         // display unit (does not change stored value)
        readonly dpi    : number;                       // for raster export only
    }

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

    export enum Unit  { INCHES = "in", MM = "mm", PX = "px", PT = "pt" }
    export enum Orientation { PORTRAIT = "portrait", LANDSCAPE = "landscape" }

    export interface Guide { axis : "x" | "y"; position : number; }

    export interface GridSettings
    {
        readonly columns : number;
        readonly rows    : number;
        readonly gutter  : number;
        readonly margin  : number;
        readonly visible : boolean;
        readonly snap    : boolean;
    }

    export interface Background
    {
        readonly kind  : "color" | "image" | "none";
        readonly color : string | null;     // hex
        readonly assetId : string | null;   // ref into doc.assets
    }

    // ── Layers ──────────────────────────────────────────────────────────────

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

    export type ObjectNode =
        | TextNode
        | ImageNode
        | ShapeNode
        | GroupNode
        | ComponentNode
        | GeneratedNode;

    export enum ObjectKind
    {
        TEXT       = "text",
        IMAGE      = "image",
        SHAPE      = "shape",
        GROUP      = "group",
        COMPONENT  = "component",
        GENERATED  = "generated",
    }

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
    // Not rendered in v1; reserved so the doc model can carry the data without
    // a breaking schema change when the feature ships.

    export interface ConditionalVisibility
    {
        readonly variable : string;                    // VariableField.key
        readonly operator : ConditionalOperator;
        readonly value    : string;                    // compared value (string-serialized)
    }

    export enum ConditionalOperator
    {
        EQ      = "eq",       // variable === value
        NEQ     = "neq",      // variable !== value
        TRUTHY  = "truthy",   // Boolean(variable) === true  (value ignored)
        FALSY   = "falsy",    // Boolean(variable) === false (value ignored)
        GT      = "gt",       // Number(variable) > Number(value)
        LT      = "lt",       // Number(variable) < Number(value)
    }

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

    export enum AnchorPoint
    {
        TOP_LEFT     = "tl", TOP_CENTER    = "tc", TOP_RIGHT    = "tr",
        MIDDLE_LEFT  = "ml", CENTER        = "c",  MIDDLE_RIGHT = "mr",
        BOTTOM_LEFT  = "bl", BOTTOM_CENTER = "bc", BOTTOM_RIGHT = "br",
    }

    // ── Text ────────────────────────────────────────────────────────────────

    export interface TextNode extends ObjectBase
    {
        readonly kind       : ObjectKind.TEXT;
        readonly role       : TextRole;
        readonly content    : Array<TextSpan>;     // rich spans
        readonly pathId     : string | null;       // text-on-path: target shape id
        readonly curved     : boolean;
        readonly vertical   : boolean;
    }

    export enum TextRole
    {
        HEADLINE = "headline",
        BODY     = "body",
        CAPTION  = "caption",
        QUOTE    = "quote",
        CUSTOM   = "custom",
    }

    export interface TextSpan
    {
        readonly text     : string;
        readonly style    : TextStyle;
    }

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

    export interface ImageNode extends ObjectBase
    {
        readonly kind    : ObjectKind.IMAGE;
        readonly assetId : string;               // ref into doc.assets
        readonly crop    : CropRect | null;
        readonly mask    : MaskRef | null;
        readonly frame   : FrameShape | null;
        readonly filters : ImageFilters;
    }

    export interface CropRect  { x : number; y : number; width : number; height : number; }
    export interface MaskRef   { shapeId : string; }
    export enum FrameShape     { CIRCLE = "circle", ROUNDED = "rounded", CUSTOM = "custom" }

    export interface ImageFilters
    {
        readonly brightness  : number;   // -1 to 1
        readonly contrast    : number;
        readonly saturation  : number;
        readonly blur        : number;   // px
        readonly colorOverlay: string | null;
    }

    // ── Shape ───────────────────────────────────────────────────────────────

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

    export type Fill = SolidFill | GradientFill | PatternFill | NoneFill;

    export interface SolidFill    { kind : "solid";    color    : string; }
    export interface GradientFill { kind : "gradient"; gradient : Gradient; }
    export interface PatternFill  { kind : "pattern";  pattern  : string; }  // SVG pattern ref
    export interface NoneFill     { kind : "none"; }

    export interface Gradient
    {
        readonly type   : "linear" | "radial";
        readonly angle  : number;
        readonly stops  : Array<GradientStop>;
    }
    export interface GradientStop { offset : number; color : string; opacity : number; }

    export interface Stroke
    {
        readonly color    : string;
        readonly width    : number;
        readonly dash     : string | null;         // SVG stroke-dasharray
        readonly lineCap  : "butt" | "round" | "square";
        readonly lineJoin : "miter" | "round" | "bevel";
    }

    export interface Shadow
    {
        readonly color   : string;
        readonly offsetX : number;
        readonly offsetY : number;
        readonly blur    : number;
        readonly opacity : number;
    }

    // ── Group ───────────────────────────────────────────────────────────────

    export interface GroupNode extends ObjectBase
    {
        readonly kind    : ObjectKind.GROUP;
        readonly objects : Array<ObjectNode>;
    }

    // ── Component (reusable design block) ───────────────────────────────────

    export interface ComponentNode extends ObjectBase
    {
        readonly kind        : ObjectKind.COMPONENT;
        readonly componentId : string;             // ref into StyleLibrary.components
        readonly overrides   : Record<string, unknown>;
    }

    // ── Generated (plugin-driven, data-backed) ───────────────────────────────

    export interface GeneratedNode extends ObjectBase
    {
        readonly kind       : ObjectKind.GENERATED;
        readonly pluginId   : string;              // e.g. "qrcode", "barcode"
        readonly params     : Record<string, unknown>;
        readonly cachedSvg  : string | null;       // last rendered output (display only)
    }

    // ── Style Library ────────────────────────────────────────────────────────

    export interface StyleLibrary
    {
        readonly textStyles      : Array<NamedTextStyle>;
        readonly objectStyles    : Array<NamedObjectStyle>;
        readonly colorStyles     : Array<NamedColor>;
        readonly components      : Array<ComponentDefinition>;
    }

    export interface NamedTextStyle   { id : string; name : string; style : TextStyle; }
    export interface NamedObjectStyle { id : string; name : string; fill  : Fill; stroke : Stroke | null; shadow : Shadow | null; }
    export interface NamedColor       { id : string; name : string; value : string; }

    export interface ComponentDefinition
    {
        readonly id      : string;
        readonly name    : string;
        readonly objects : Array<ObjectNode>;   // the template tree
    }

    // ── Variables ─────────────────────────────────────────────────────────────

    export interface VariableSet
    {
        readonly fields  : Array<VariableField>;
        readonly preview : Record<string, string>;   // sample data for editor preview
    }

    export interface VariableField
    {
        readonly key   : string;         // "FirstName"
        readonly label : string;         // "First Name"
        readonly type  : VariableType;
        readonly defaultValue : string;
    }

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

    export interface BrandRef
    {
        readonly brandId : string;
        readonly locked  : boolean;    // prevent off-brand color/font choices
    }

    // ── Plugin state ─────────────────────────────────────────────────────────

    export interface PluginState
    {
        readonly pluginId : string;
        readonly enabled  : boolean;
        readonly config   : Record<string, unknown>;
    }

    // ── Export settings ──────────────────────────────────────────────────────

    export interface ExportSettings
    {
        readonly format         : ExportFormat;
        readonly dpi            : number;
        readonly outlineFonts   : boolean;
        readonly embedFonts     : boolean;
        readonly colorSpace     : "rgb" | "cmyk";
        readonly includeCropMarks       : boolean;
        readonly includeRegistrationMarks : boolean;
        readonly includeColorBars       : boolean;
        readonly includeBleed           : boolean;
        readonly transparentBackground  : boolean;
    }

    export enum ExportFormat { SVG = "svg", PNG = "png", JPEG = "jpeg", PDF = "pdf" }

    // ── Asset registry ───────────────────────────────────────────────────────

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

    export enum AssetKind
    {
        IMAGE      = "image",        // PNG, JPEG, SVG from media library
        SVG        = "svg",          // standalone SVG asset
        FONT_CDN   = "font_cdn",     // Google Fonts (or any external CDN font stylesheet URL)
        FONT_CUSTOM = "font_custom", // placeholder: future account-uploaded font hosted on S3/CDN
    }

    // ── Schema version ────────────────────────────────────────────────────────

    export const SCHEMA_VERSION : number = 1;

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
```

---

## 4. Object Model

Every object on the canvas is an `ObjectNode`. The hierarchy is:

```
Doc
└── Page[]
    └── Layer[]
        └── ObjectNode[]  (TextNode | ImageNode | ShapeNode | GroupNode | ComponentNode | GeneratedNode)
            └── GroupNode.objects → ObjectNode[]   (nested groups allowed)
```

**Key design decisions:**

| Decision | Rationale |
|---|---|
| Path data stored as SVG `d=` strings | Renders directly; no custom path AST needed for v1 |
| All positions in points (pt) | Single coordinate system; unit labels are display-only |
| Transforms stored decomposed (x/y/rotation/scale) | Easier property panel; compose to SVG `transform` on render |
| `cachedSvg` on `GeneratedNode` | Generated objects (QR, barcode) cache their SVG for fast re-render; regenerated on param change |
| `styleRef` on `TextStyle` | Allows global named styles to propagate updates without re-walking the tree |

---

## 5. Plugin Architecture

Plugins are the extension point for everything outside the core editor: generated components, specialty export, future AI features.

### 5.1 Plugin Interface

```typescript
// packages/api/src/media/model/SvgPlugin.ts

export namespace SvgPlugin
{
    export interface Manifest
    {
        readonly id          : string;          // e.g. "qrcode", "usps-barcode"
        readonly name        : string;
        readonly version     : string;
        readonly objectKinds : Array<string>;   // ObjectKind values this plugin handles
        readonly panelIds    : Array<string>;   // workspace panels contributed
        readonly menuItems   : Array<string>;   // toolbar/context-menu items contributed
    }

    // What the editor calls when it needs a GeneratedNode rendered
    export interface GenerateRequest
    {
        readonly pluginId : string;
        readonly params   : Record<string, unknown>;
        readonly width    : number;
        readonly height   : number;
    }

    export interface GenerateResult
    {
        readonly svg      : string;             // rendered SVG fragment
        readonly warnings : Array<string>;
    }

    // What the editor calls for specialty export passes
    export interface ExportHook
    {
        readonly pluginId : string;
        readonly phase    : "pre-flight" | "post-process";
        readonly format   : SvgDocument.ExportFormat;
    }
}
```

### 5.2 Plugin Registration

Plugins register server-side (media service) and client-side (web app) independently:

- **Server-side:** Each plugin is a module in `apps/core/media/src/plugins/<name>/`. It exports a `generate(request)` function and any `exportHook` handlers. The media service routes `PostSvgPluginRender` requests to the correct plugin by `pluginId`.
- **Client-side:** Each plugin registers a React panel component and/or a toolbar action via a plugin registry (`SvgEditorPluginRegistry`). Panels are lazy-loaded.

### 5.3 Built-in Plugins (v1 scope)

| Plugin ID | Object Kind | Description |
|---|---|---|
| `qrcode` | `generated` | QR code from URL/text; params: payload, error correction, colors |
| `barcode-128` | `generated` | Code-128 barcode |
| `usps-barcode` | `generated` | Intelligent Mail barcode for USPS |
| `progress-bar` | `generated` | Configurable progress/percentage bar |
| `coupon` | `generated` | Coupon block with dashes, code, barcode |

---

## 6. Canvas & Rendering

### 6.1 Approach

The canvas is a **React-managed SVG element** — not a canvas2d element, not a third-party abstraction like Fabric.js. This keeps the document model as the single source of truth and avoids a translation layer.

```
SvgDocument (JSON)
    ↓  compile()
SVGElement (DOM)   ← what the browser renders
    ↓  (on export)
serialize → SVG string → export pipeline
```

The compiler (`SvgCompiler`) is a pure function: `compile(doc: SvgDocument.Doc, page: SvgDocument.Page) → SVGElement`. It runs in a worker thread to avoid blocking UI during complex renders.

### 6.2 Interaction Layer

Selection, drag, resize, and rotate handles live in a separate **interaction overlay** rendered as a normal DOM `div` positioned over the SVG viewport. This separation means the SVG output is never polluted with editor artifacts.

```
<div class="canvas-container">
  <svg id="design-canvas"> ... compiled SVG ... </svg>
  <div id="interaction-overlay"> ... handles, selection box, rulers ... </div>
</div>
```

### 6.3 Coordinate System

All positions are in **points (pt)** in the document model. The canvas applies a **viewport transform** (zoom + pan) as an SVG `viewBox` + CSS `transform`. The interaction overlay applies the same matrix so handles stay aligned.

### 6.4 Selection State

Selection state lives in `SvgEditorStore` (Zustand), NOT in the document model. It is ephemeral:

```typescript
interface SvgEditorStore
{
    selectedIds      : Set<string>;
    hoveredId        : string | null;
    activePage       : string;
    activeLayer      : string;
    zoom             : number;
    panX             : number;
    panY             : number;
    tool             : ToolMode;
    clipboard        : Array<SvgDocument.ObjectNode> | null;
    history          : HistoryStack;
    pluginPanelOpen  : string | null;
}

enum ToolMode
{
    SELECT    = "select",
    TEXT      = "text",
    SHAPE     = "shape",
    PEN       = "pen",
    IMAGE     = "image",
    PAN       = "pan",
    ZOOM      = "zoom",
}
```

### 6.5 History (Undo/Redo)

History uses **JSON-patch diffs** against the document model. Each undoable operation produces a pair of forward/inverse patches stored in a bounded ring buffer (100 steps). Large operations (multi-select move) are collapsed into a single undo step.

---

## 7. Document Storage & Versioning

### 7.1 Storage Layout

The document JSON lives in S3. DynamoDB holds only the metadata row — it never stores the document body.

```
S3 bucket: media-assets/{env}
  svg-docs/{accountId}/{projectId}.json     ← SvgDocument.Doc (current)
  svg-docs/{accountId}/{projectId}.thumb.png ← 300×400 thumbnail (regenerated on save)

DynamoDB: media-studio table
  SvgProject row
    ├── id           : projectId
    ├── accountId
    ├── kind         : "svg"
    ├── name
    ├── canvasKey    : string   — S3 key of the JSON doc (e.g. "svg-docs/{accountId}/{projectId}.json")
    ├── thumbnailKey : string   — S3 key of the thumbnail PNG
    ├── createdAt    : number
    └── updatedAt    : number
```

No version counter lives in either store — document history is S3 object versioning on the `.json` key. Each `PUT` to that key creates a new S3 version automatically; no application logic is needed to increment a counter.

### 7.2 Save Flow

```
Client (autosave / manual save)
  │
  ├─ PUT /svg/canvas  (PutSvgCanvasImpl)
  │     ├── validate SvgDocument shape (schemaVersion check)
  │     ├── PUT object to S3 (canvasKey) → S3 creates new version
  │     ├── regenerate thumbnail (async, SQS job)
  │     └── update DynamoDB row (updatedAt only)
  │
  └─ returns { savedAt: ISO timestamp }
```

**Autosave:** The editor debounces saves at a 2-second idle interval. The user also sees a manual Save button with a dirty-state indicator.

### 7.3 Version History

`GetItemVersions` calls `s3.listObjectVersions(canvasKey)` and returns the version list. `PostItemRevert` copies the target S3 version back as the new current object (a new S3 version, not an in-place overwrite). The history panel shows version timestamps and size; no diff summary in v1 (the versions are full JSON snapshots).

### 7.4 Document Size

At ≤ 2 pages with typical designs the JSON is well under 1 MB uncompressed. The S3 PUT request uses `Content-Encoding: gzip` for transfer compression; S3 stores and serves the raw JSON (no server-side compression needed — S3 handles it at the HTTP level).

---

## 8. API Contracts

All contracts live in `packages/api/src/media/`. New contracts are additive; existing Studio endpoints are reused.

### 8.1 Reused (no changes)

| Endpoint | Usage |
|---|---|
| `GetStudioProjects` | List SVG projects (add `kind: "svg"` filter param) |
| `PostStudioProject` | Create new SVG project |
| `PatchStudioProject` | Rename, archive |
| `DeleteStudioProject` | Delete |
| `GetStudioCanvas` | Load `SvgDocument.Doc` |
| `PutStudioCanvas` | Save `SvgDocument.Doc` |
| `GetItemVersions` | Version history |
| `PostItemRevert` | Restore version |

### 8.2 New Contracts

```typescript
// packages/api/src/media/PostSvgRender.ts
// Render one or more pages to the target format (runs export pipeline server-side)
export class PostSvgRender extends RestfulEndpoint<{}, PostSvgRender.Body, PostSvgRender.Response>
{
    public readonly uri      = PostSvgRender.URI;
    public readonly method   = NetworkUtils.Method.POST;
    public readonly access   = Access.AccountRole.USER;
    public readonly audience = RestfulEndpoint.Audience.APP;
}
export namespace PostSvgRender
{
    export const URI     = apiPath( "media", 1, "/svg/render" );
    export interface Body {
        projectId : string;
        pageIds   : Array<string> | null;    // null = all pages
        settings  : SvgDocument.ExportSettings;
    }
    export interface Response {
        jobId     : string;                  // async — poll GetSvgRenderJob
    }
}

// packages/api/src/media/GetSvgRenderJob.ts
export class GetSvgRenderJob extends RestfulEndpoint<GetSvgRenderJob.Query, {}, GetSvgRenderJob.Response> { ... }
export namespace GetSvgRenderJob
{
    export const URI = apiPath( "media", 1, "/svg/render/:jobId" );
    export interface Query  { jobId : string; }
    export interface Response {
        status    : RenderStatus;
        outputUrl : string | null;           // presigned S3 URL when complete
        error     : string | null;
    }
    export enum RenderStatus { PENDING = "pending", PROCESSING = "processing", DONE = "done", FAILED = "failed" }
}

// packages/api/src/media/PostSvgPluginRender.ts
// Server-side plugin execution (QR, barcode, etc.)
export class PostSvgPluginRender extends RestfulEndpoint<{}, PostSvgPluginRender.Body, PostSvgPluginRender.Response> { ... }
export namespace PostSvgPluginRender
{
    export const URI = apiPath( "media", 1, "/svg/plugins/:pluginId/render" );
    export interface Body   extends SvgPlugin.GenerateRequest {}
    export interface Response extends SvgPlugin.GenerateResult {}
}

// packages/api/src/media/GetSvgTemplates.ts
// List available document templates
export class GetSvgTemplates extends RestfulEndpoint<GetSvgTemplates.Query, {}, GetSvgTemplates.Response> { ... }
export namespace GetSvgTemplates
{
    export const URI = apiPath( "media", 1, "/svg/templates" );
    export interface Query    { category : SvgTemplate.Category | null; }
    export interface Response { templates : Array<SvgTemplate.Summary>; }
}

// packages/api/src/media/PostSvgFromTemplate.ts
// Create a new project from a template
export class PostSvgFromTemplate extends RestfulEndpoint<{}, PostSvgFromTemplate.Body, PostSvgFromTemplate.Response> { ... }
export namespace PostSvgFromTemplate
{
    export const URI = apiPath( "media", 1, "/svg/templates/:templateId/create" );
    export interface Body     { name : string; }
    export interface Response { projectId : string; }
}
```

---

## 9. Web UI Architecture

### 9.1 Entry Point

```
apps/core/web/src/
  pages/media/
    SvgProjects.tsx              — project list / gallery
    SvgProjectEditor.tsx         — full-screen editor shell (loads the editor widget)
    dialogs/
      NewSvgProjectDialog.tsx    — name + template picker
      ExportDialog.tsx           — export settings + trigger render
      VersionHistoryDialog.tsx   — browse + restore versions (reuses email pattern)
  widgets/svg/
    SvgDesignEditor.tsx          — editor shell (toolbar + canvas + panels)
    editor/
      SvgCanvas.tsx              — SVG canvas + interaction overlay
      SvgCompiler.ts             — doc → SVG DOM (pure, no React)
      SvgEditorStore.ts          — Zustand store (selection, tool, history)
      SvgEditorModel.ts          — pure constants (tool defs, snap config, unit converters)
      InteractionOverlay.tsx     — handles, bounding boxes, guides
      RulerBar.tsx               — top + left rulers
    panels/
      SvgLayersPanel.tsx         — layer tree + object list
      SvgAssetsPanel.tsx         — brand assets + image library
      SvgPagesPanel.tsx          — page thumbnails + add/reorder
      SvgStylesPanel.tsx         — named styles library
      SvgHistoryPanel.tsx        — undo history / version snapshots
    inspector/
      SvgPropertyInspector.tsx   — context-sensitive right panel shell
      TextInspector.tsx          — text object properties
      ImageInspector.tsx         — image object properties
      ShapeInspector.tsx         — shape fill/stroke/shadow
      TransformInspector.tsx     — x/y/w/h/rotation numeric inputs (shared)
      GroupInspector.tsx         — group-level opacity/lock
      GeneratedInspector.tsx     — plugin param form (dynamic)
    toolbar/
      SvgMainToolbar.tsx         — top toolbar (tool selector, undo/redo, zoom, export)
      SvgContextToolbar.tsx      — secondary row (context-sensitive options for selected tool)
    objects/
      TextObject.tsx             — SVG text renderer
      ImageObject.tsx            — SVG image renderer
      ShapeObject.tsx            — SVG shape renderer
      GroupObject.tsx            — SVG group renderer
      GeneratedObject.tsx        — renders cachedSvg or triggers plugin
    plugins/
      PluginRegistry.ts          — registers client-side panels/actions per pluginId
      qrcode/
        QrCodePanel.tsx
        QrCodeObject.tsx
      barcode/
        BarcodePanel.tsx
        BarcodeObject.tsx
```

### 9.2 State Management

| State | Where | Rationale |
|---|---|---|
| Document model (`SvgDocument.Doc`) | Zustand `SvgEditorStore` | Drives undo/redo history via patches |
| Selection, hover, active page/layer | Zustand `SvgEditorStore` | Ephemeral; never persisted |
| Tool mode, zoom, pan | Zustand `SvgEditorStore` | Ephemeral |
| Autosave dirty flag | Zustand `SvgEditorStore` | Drives debounced save |
| Template list, project list | React Query (server state) | Standard fetch/cache pattern |
| Export job status | React Query (polling) | Polls `GetSvgRenderJob` until done |

### 9.3 Simple / Advanced Mode Toggle

The Property Inspector has a **mode toggle** (Simple | Advanced):

- **Simple:** Shows fill color, opacity, basic text controls. Hides gradient editor, stroke dash, transform matrix, SVG path editor.
- **Advanced:** All controls visible. Remembered per session in localStorage.

This toggle lives in `SvgEditorStore.inspectorMode` and each inspector component renders conditionally.

---

## 10. Export Pipeline

Export is **server-side only** — the browser never has to install a PDF renderer.

```
Client                          Media Service
──────                          ─────────────
POST /svg/render  ──────────►  PostSvgRenderImpl
                                 ├── load SvgDocument.Doc from S3 (canvasKey)
                                 ├── compile to SVG string (SvgCompiler Node.js port)
                                 ├── apply export settings (DPI, bleed, crop marks)
                                 ├── fetch + inline Google Fonts (stylesheet → @font-face → binary)
                                 ├── run plugin hooks (pre-flight)
                                 ├── format branch:
                                 │     SVG  → serialize (fonts embedded or outlined per setting)
                                 │     PNG  → Puppeteer: load SVG in headless Chrome → screenshot
                                 │     JPEG → Puppeteer screenshot → sharp compress
                                 │     PDF  → Puppeteer: print-to-PDF (highest fidelity)
                                 ├── upload output to S3 (media-exports/{accountId}/{jobId}.{ext})
                                 └── publish Kafka event (media.asset CREATED)

Client polls GET /svg/render/:jobId until status = DONE, then downloads from outputUrl
```

**Puppeteer rationale:** All raster and PDF export uses Puppeteer (headless Chrome). This is the only path that guarantees pixel-perfect font rendering, SVG filter fidelity, and print-to-PDF quality matching the on-screen preview. Lambda cold-start latency is acceptable for an async export job (the client polls).

**Font handling:**
- Google Fonts are fetched at render time via the Google Fonts CSS API, `@font-face` rules are inlined into the SVG, and the binary font data is embedded — so the exported file is self-contained regardless of the `outlineFonts` setting.
- When `outlineFonts = true`, Puppeteer renders text as paths (no font dependency in the output).
- Future custom fonts (`AssetKind.FONT_CUSTOM`) will be fetched from their S3/CDN URL and inlined the same way.

**CMYK:** Applied as a color-space conversion post-process on the PDF; SVG and raster outputs stay RGB.

---

## 11. Brand Assets

Brand assets are linked via `SvgDocument.BrandRef` and pulled from the existing Account branding system. The editor surfaces:

- **Colors:** Brand palette swatches appear at the top of the color picker
- **Fonts:** Brand fonts appear at the top of the font picker
- **Logos:** Brand logos in the Assets panel under "Brand"
- **Lock mode:** When `BrandRef.locked = true`, color and font pickers enforce brand palette/fonts only (soft enforcement — warnings, not hard blocks)

Brand data is fetched via the existing account service; no new endpoints needed.

---

## 12. Typography

### 12.1 Font Sources (in priority order)

| Priority | Source | Storage | v1? |
|---|---|---|---|
| 1 | **Brand fonts** | Account branding system (CDN URL) | Yes |
| 2 | **Google Fonts** | Google Fonts CDN (fetched by stylesheet URL) | Yes |
| 3 | **Custom account fonts** | S3/CDN URL (future — `AssetKind.FONT_CUSTOM`) | Placeholder only |
| 4 | **System web-safe stack** | Browser built-in | Fallback |

Fonts are referenced in the document as `Asset` entries with `kind = FONT_CDN` (or future `FONT_CUSTOM`). The `cdnUrl` on the asset holds the Google Fonts stylesheet URL (e.g. `https://fonts.googleapis.com/css2?family=Open+Sans:wght@400;700`). The SvgCompiler injects a `<style>` block with the `@import` at the top of the SVG.

**Custom font placeholder:** The `AssetKind.FONT_CUSTOM` entry exists in the model now so v1 documents can reference a future hosted font without a schema change. The picker will show a disabled "Upload custom font" option in the font panel; the upload flow ships in a later phase. Accepted upload formats when that ships: **TTF and OTF only** (see §12.3 below).

### 12.2 Font Roles

Named roles map to a `TextStyle` in the document's `StyleLibrary`:

| Role | Default |
|---|---|
| `headline` | Brand headline font, 36pt, bold |
| `body` | Brand body font, 12pt, regular |
| `caption` | Brand body font, 10pt, regular, 60% opacity |
| `quote` | Brand headline font, 24pt, italic |

### 12.3 Convert to Outlines — Eligible Font Formats

"Convert to outlines" converts text glyphs to SVG path data, removing any font dependency from the exported file. It is an export-time server-side operation (via Puppeteer's print path) — it is **not** a destructive in-editor edit; the `TextNode` remains fully editable.

For the future client-side path utility version (which would use opentype.js to parse the font binary and compute glyph paths), **only TTF and OTF** are processable:

| Format | Convert to outlines (client-side) | Reason |
|---|---|---|
| TTF | Supported | Binary format readable by opentype.js |
| OTF (CFF) | Supported | CFF outlines supported by opentype.js |
| WOFF | Not supported | Requires decompression first; v2 if needed |
| WOFF2 | Not supported | Brotli-compressed; no browser API to decompress for path extraction |

Google Fonts CDN delivers WOFF2 to browsers (for display) but also exposes TTF/OTF download URLs. The export pipeline fetches the TTF/OTF URL directly when it needs to embed or outline a Google Font — the browser-facing WOFF2 URL is never used server-side.

### 12.4 Variable Fonts

Variable font axes (weight, width, slant) are exposed in the font picker's Advanced section when the selected font is a variable font. The axis values are stored in `TextStyle.fontWeight` (as a number) and as additional CSS `font-variation-settings` values in the compiled SVG.

---

## 13. Color System

### 13.1 Input Modes

The color picker supports:

| Mode | Fields |
|---|---|
| HEX | `#RRGGBB` + alpha |
| RGB | R 0–255, G 0–255, B 0–255, A 0–100% |
| HSL | H 0–360, S 0–100%, L 0–100%, A 0–100% |
| CMYK (display only) | C/M/Y/K 0–100% — read-only; CMYK export is applied at render time |

### 13.2 Swatches

Swatch groups (in order):

1. Brand colors (from `BrandRef`)
2. Document colors (from `StyleLibrary.colorStyles`)
3. Recently used (session, not persisted)

### 13.3 Gradients

The gradient editor exposes:

- Linear vs. radial toggle
- Angle control (linear)
- Stop list with color + opacity per stop
- Drag-to-reposition stops on the gradient bar

### 13.4 No Hard-coded Colors

All editor chrome uses MUI theme tokens. No hex literals in components.

---

## 14. Variables / Merge Fields

Variables allow personalized print runs and data-driven designs.

### 14.1 Syntax

`{{FieldKey}}` inside a `TextSpan.text` or `ShapeNode.pathData`. The compiler substitutes preview values during edit and real values during export/merge.

### 14.2 Built-in Variable Types

| Type | Behavior |
|---|---|
| `text` | Substituted as-is |
| `number` | Formatted per locale |
| `date` | Formatted per locale |
| `url` | Substituted as a link; validated |
| `qr_code` | Renders a QR code using the variable value as payload (calls QR plugin) |
| `image` | Substituted with an image asset by URL |

### 14.3 Conditional Visibility (v2)

Any `ObjectNode` may carry a `conditionalVisibility` rule (see `ObjectBase`). When the rule evaluates to false against the current variable values, the object is hidden on canvas and omitted from the compiled SVG at export time. In v1 this field is stored in the doc model but not evaluated — all objects render regardless. The editor will show a small indicator badge on objects that carry a rule so designers can see the condition is present.

Example: show `ElementA` when `{{IsMember}} eq "true"`, show `ElementB` when `{{IsMember}} eq "false"`. Both objects exist in the doc; only one is present in any given rendered output.

### 14.4 Preview Mode

The editor displays `VariableSet.preview` values (sample data) on canvas by default. A toggle switches between preview data and the raw `{{syntax}}` display.

### 14.6 Merge Export

For batch mail merges: the render job accepts a `mergeData` array (one object per recipient). The pipeline emits one output file per row. This is a v2 feature; v1 supports single-record preview only.

---

## 15. Print Features

Print features are visualized on-canvas (not just at export time):

| Feature | Canvas visualization |
|---|---|
| **Bleed** | Dashed red border outside the page edge |
| **Safe area** | Dashed blue border inside the page edge |
| **Crop marks** | Corner tick marks shown at 100%+ zoom |
| **Trim line** | Solid line at the page boundary |

These overlays are rendered in the `InteractionOverlay` component, controlled by toggles in the View menu. They do not appear in the compiled SVG output.

---

## 16. Templates

### 16.1 Storage

Templates have their own DynamoDB table (`svg-templates`) and their own S3 prefix. They are NOT `SvgProject` rows.

```
DynamoDB: svg-templates table
  SvgTemplate row
    ├── id           : templateId
    ├── scope        : TemplateScope ("system" | "account")
    ├── accountId    : string | null   — null for system templates
    ├── name         : string
    ├── category     : TemplateCategory
    ├── canvasKey    : string          — S3 key of the SvgDocument.Doc JSON
    ├── thumbnailKey : string          — S3 key of the pre-rendered 300×400 thumbnail PNG
    ├── tags         : Array<string>
    ├── createdAt    : number
    └── updatedAt    : number

S3 bucket: media-assets/{env}
  svg-templates/system/{templateId}.json       ← system template docs (deployed by ops)
  svg-templates/system/{templateId}.thumb.png
  svg-templates/{accountId}/{templateId}.json  ← account-level saved templates
  svg-templates/{accountId}/{templateId}.thumb.png
```

### 16.2 Scopes

| Scope | Who creates it | Who sees it | Editable? |
|---|---|---|---|
| `system` | Ops / platform team | All accounts | No (read-only) |
| `account` | Any account user ("Save as template") | That account only | Yes |

`GetSvgTemplates` returns system templates + the requesting account's own templates. The UI groups them (System / My Templates).

### 16.3 Template Categories

```typescript
export enum SvgTemplate.Category
{
    FLYER         = "flyer",
    POSTCARD      = "postcard",
    MAILER        = "mailer",
    DOOR_HANGER   = "door_hanger",
    BUSINESS_CARD = "business_card",
    BROCHURE      = "brochure",
    LETTER        = "letter",
    SIGN          = "sign",
    SOCIAL        = "social",
    BLANK         = "blank",
}
```

### 16.4 Creating a Project from a Template

`PostSvgFromTemplate` copies the template's S3 JSON to a new `SvgProject` S3 key (`svg-docs/{accountId}/{newProjectId}.json`) and creates the `SvgProject` DynamoDB row. No modification of the template itself occurs; the copy is the user's editable project.

### 16.5 Saving as Template

A "Save as Template" action in the editor POSTs to a new `PostSvgTemplate` endpoint, which copies the current project's S3 JSON to `svg-templates/{accountId}/{newTemplateId}.json` and creates an `account`-scoped `SvgTemplate` row.

---

## 17. Editing Operations & Keyboard Shortcuts

| Operation | Shortcut | Notes |
|---|---|---|
| Undo | `⌘Z` | Reverses last JSON-patch |
| Redo | `⌘⇧Z` / `⌘Y` | |
| Copy | `⌘C` | Copies to internal clipboard (preserves full node model) |
| Paste | `⌘V` | Pastes with small offset so it's visible |
| Duplicate | `⌘D` | Copy + Paste in one step |
| Delete | `⌫` / `Delete` | |
| Select All | `⌘A` | Selects all objects on active layer |
| Group | `⌘G` | Wraps selection in a `GroupNode` |
| Ungroup | `⌘⇧G` | Dissolves top-level group |
| Bring Forward | `⌘]` | |
| Send Back | `⌘[` | |
| Bring to Front | `⌘⌥]` | |
| Send to Back | `⌘⌥[` | |
| Lock | `⌘L` | |
| Zoom In | `⌘=` | |
| Zoom Out | `⌘-` | |
| Fit to Page | `⌘0` | |
| 100% Zoom | `⌘1` | |
| Pan (temp) | `Space` (hold) | Switches to pan tool while held |
| Constrain resize | `⇧` (hold) | Locks aspect ratio |
| Center resize | `⌥` (hold) | Resizes from center |
| Nudge 1pt | Arrow keys | |
| Nudge 10pt | `⇧` + Arrow keys | |
| Add Text | `T` | |
| Select tool | `V` / `Esc` | |
| Pen tool | `P` | |
| Rectangle | `R` | |
| Ellipse | `E` | |

---

## 18. Precision Controls

The Transform Inspector shows numeric inputs for every selected object:

| Property | Input | Constraint |
|---|---|---|
| X | Number (unit-aware) | — |
| Y | Number (unit-aware) | — |
| Width | Number (unit-aware) | ≥ 1pt |
| Height | Number (unit-aware) | ≥ 1pt |
| Rotation | Number, °, –360 to 360 | |
| Opacity | Number, %, 0–100 | |
| Scale X | Number, % | |
| Scale Y | Number, % | |
| Anchor | 9-point picker | Changes the origin for x/y reference |

Multi-select: shows the **bounding box** of the selection; editing applies a proportional transform to all selected objects.

**Advanced:** A collapsible "Matrix" section shows the raw SVG transform matrix and allows direct input. This is in the Advanced inspector mode.

---

## 19. Layers & Z-Order

- **Unlimited layers** per page
- Layer panel: click to select, double-click to rename
- Drag to reorder layers (dnd-kit / `@dnd-kit/sortable`)
- Toggle visibility (eye icon) and lock (lock icon) per layer
- Layer opacity slider
- Objects within a layer are ordered bottom-to-top (same as SVG z-order)
- Object list is shown nested under each layer, collapsible
- Objects can be dragged between layers in the panel

---

## 20. Alignment & Distribution

Available when 2+ objects are selected. Anchored to:
- **Selection bounding box** (default)
- **Page** (align to page edges)
- **Key object** (click to designate one selected object as the anchor)

| Align | Distribute |
|---|---|
| Left edges | Horizontal spacing (equal gaps between left edges) |
| Right edges | Vertical spacing (equal gaps between top edges) |
| Top edges | |
| Bottom edges | |
| Horizontal center | |
| Vertical center | |

**Snap:**
- Snap to grid (configurable grid per page)
- Snap to guides (drag from rulers to create guides)
- Snap to object edges (nearest pixel when within 4px threshold)
- Smart guides (dynamic alignment lines shown while dragging)

All snap behavior toggleable via View menu + toolbar icon.

---

## 21. Advanced SVG Editing

### 21.1 Node Editing (Pen Tool)

When a `ShapeNode` with `shapeType = PATH` is selected and the user activates the pen tool:
- The path `d=` string is parsed into a node list
- Each node is rendered as a handle in the InteractionOverlay
- Bezier control handles shown for curve nodes
- Drag nodes or handles to edit; path `d=` is recomputed and written back

### 21.2 Boolean Operations

Applied to 2+ selected `ShapeNode`s:

| Operation | SVG strategy |
|---|---|
| Union | Merge paths (paper.js or Clipper.js) |
| Subtract | Clip the bottom shape with the top |
| Intersect | Keep only the overlapping region |

Result is a new `ShapeNode` with `shapeType = PATH` and computed `pathData`. Original objects are removed. The operation is undoable.

### 21.3 Path Utilities

- **Simplify path:** Reduce node count (Ramer–Douglas–Peucker algorithm)
- **Offset path:** Expand or contract a path by N pt
- **Outline stroke:** Convert a stroked path to a filled shape (stroke-width → path)
- **Convert text to outlines:** Destructive; converts a `TextNode` to a `ShapeNode` with `pathData`

---

## 22. Perspective Objects (v2)

Not in v1. Specified here for architectural awareness so v1 doesn't block it.

A `PerspectiveNode` wraps another `ObjectNode` and applies a perspective quad warp. The editor shows 4 corner handles; the SVG output uses an `feTurbulence`-free CSS/SVG matrix approximation or a Puppeteer-rendered raster fallback for complex warps.

Examples: sign on a wall, billboard, TV screen, printed piece in a photo.

---

## 23. Generated Components

Served via the plugin system. Each `GeneratedNode` stores typed `params` and a `cachedSvg`. The plugin's `generate()` function is called server-side via `PostSvgPluginRender` when params change. The result updates `cachedSvg` and re-renders on canvas.

### v1 Plugin Inventory

| Plugin | Params | Output |
|---|---|---|
| `qrcode` | payload, errorCorrection, fgColor, bgColor | SVG QR matrix |
| `barcode-128` | payload, showText, color | SVG barcode |
| `usps-barcode` | imb (Intelligent Mail Barcode fields) | SVG IMb barcode |
| `progress-bar` | value 0–100, fgColor, bgColor, shape, label | SVG bar |
| `coupon` | code, discount, expiry, barcodeType | SVG coupon block |

### v2 Plugin Ideas (not scoped)

- Charts (bar, pie, line) from CSV/JSON data
- Calendar block
- Address block (formatted from Contact model fields)
- Personalized name (large format, driven by a variable)

---

## 24. Phase Breakdown

### Phase 1 — Core Editor (MVP)

- Document model + SvgCompiler
- Canvas render (SVG DOM)
- Interaction overlay (select, move, resize, rotate)
- Text, image, and shape objects
- Layers panel
- Pages panel (single page for MVP)
- Property inspector (transform + basic fill/text)
- Undo/redo (JSON patch)
- Autosave to existing `PutStudioCanvas`
- PNG export (server-side, Puppeteer)
- Blank + 3 starter templates (Letter, Business Card, Social 1×1)
- Google Fonts picker (top 50 fonts)

### Phase 2 — Professional Features

- Multi-page support
- PDF export (with bleed, crop marks)
- Named styles (text, color, object)
- Alignment tools + smart guides
- Gradient editor
- Group + boolean operations
- Brand asset integration
- Version history panel
- All PagePreset sizes
- QR code + barcode plugins

### Phase 3 — Advanced

- Variables / merge fields
- Node editing (pen tool)
- Path utilities (offset, outline stroke, simplify)
- Custom font upload
- Components (reusable design blocks)
- CMYK color output
- Full template library (all categories)
- Print preflight plugin

### Phase 4 — Platform Extension

- Plugin marketplace / custom plugin registration
- Perspective objects
- Variable fonts (full axis control)
- Batch merge export
- Perspective objects
- AI features (separate spec)

---

## 25. Architectural Decisions Log

| Decision | Choice | Rationale |
|---|---|---|
| Canvas rendering engine | React + SVG DOM; svg.js for path boolean math only | No translation layer; document model is the single source of truth; tldraw was evaluated but lacks custom font and export-pipeline control |
| PDF / PNG / JPEG export renderer | Puppeteer (headless Chrome) | Highest fidelity — matches on-screen preview exactly; acceptable for async export jobs |
| Document storage | S3 (JSON), not DynamoDB blob | Unlimited size headroom; S3 object versioning handles history for free; max 2 pages keeps files small |
| Document versioning | S3 object versioning | No application-level version counter in the doc; `schemaVersion` in `Doc` is for JSON shape migration only |
| Template storage | Separate `svg-templates` DynamoDB table + S3 asset per template | Clean separation from projects; supports both system and account scopes |
| Template scopes | System (platform) + Account (per-org saved templates) | System templates are global read-only; accounts can fork or create their own |
| Drag-and-drop (panels / layers) | `@dnd-kit/sortable` | Consistent with email editor pattern; custom pointer events used for canvas-object drag |
| Font sources (v1) | Google Fonts CDN + brand fonts; custom upload placeholder in model | WOFF2 from CDN for display; TTF/OTF fetched server-side for embed/outline at export time |
| Font embed in PDF | Embedded by default (`embedFonts: true`) | Self-contained exports; outline option available for print shops that require outlines |
| Fonts eligible for convert-to-outlines | TTF and OTF only | opentype.js can parse these; WOFF/WOFF2 need decompression not available in this pipeline |
| Conditional visibility | v2 — model field reserved now | `ObjectBase.conditionalVisibility` carries the rule today so the schema won't break when the feature ships; not evaluated in v1 |
