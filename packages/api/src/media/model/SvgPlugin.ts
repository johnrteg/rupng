//
// SvgPlugin — the extension-point contract for the SVG editor's plugins (generated components like QR/barcode,
// specialty export passes, future AI). A plugin declares a Manifest; the editor calls generate(request) to
// render a GeneratedNode and runs exportHook handlers during export. Owned by the media service; imported by
// the web editor + server-side plugin modules (single source of truth — never re-declared at a call site).
//
import { SvgDocument } from "./SvgDocument";

export namespace SvgPlugin
{
    /** A plugin's self-description — its id, the object kinds it renders, and the panels/menu items it adds. */
    export interface Manifest
    {
        readonly id          : string;          // e.g. "qrcode", "usps-barcode"
        readonly name        : string;
        readonly version     : string;
        readonly objectKinds : Array<string>;   // ObjectKind values this plugin handles
        readonly panelIds    : Array<string>;   // workspace panels contributed
        readonly menuItems   : Array<string>;   // toolbar/context-menu items contributed
    }

    /** What the editor sends when it needs a GeneratedNode rendered (params + the target box in pt). */
    export interface GenerateRequest
    {
        readonly pluginId : string;
        readonly params   : Record<string, unknown>;
        readonly width    : number;
        readonly height   : number;
    }

    /** The rendered result — an SVG fragment plus any non-fatal warnings to surface. */
    export interface GenerateResult
    {
        readonly svg      : string;             // rendered SVG fragment
        readonly warnings : Array<string>;
    }

    /** A specialty export pass a plugin registers for (pre-flight validation or post-process). */
    export interface ExportHook
    {
        readonly pluginId : string;
        readonly phase    : "pre-flight" | "post-process";
        readonly format   : SvgDocument.ExportFormat;
    }
}

export default SvgPlugin;
// eof
