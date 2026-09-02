//
import { SvgDocument } from "@repo/api";

//
// SvgItemExportModel — the file-format types for exporting/importing a single Studio SVG-editor item
// (an object subtree + the `doc.assets` entries it references) as a `.zip` (manifest.json + assets/…). This
// is a client-only file format, not a network contract, so it lives here rather than in @repo/api.
//

/** The manifest's JSON-shape version — bump only on a breaking shape change. */
export const SCHEMA_VERSION : number = 1;

/** The zipped bundle's manifest.json — the exported object subtree + the assets it references. */
export interface Manifest
{
    readonly schemaVersion : number;
    readonly exportedAt    : string;
    readonly object        : SvgDocument.ObjectNode;
    readonly assets        : Array<ManifestAsset>;
}

/** One `doc.assets` entry carried by the manifest, plus where to find its bytes in the zip (if any) and the
 *  original Media Library id (checked on import to offer "use existing" vs "import as new copy"). */
export interface ManifestAsset
{
    readonly id            : string;              // matches the Asset.id referenced by the object's assetId
    readonly kind          : SvgDocument.AssetKind;
    readonly name          : string;
    readonly mimeType      : string;
    readonly sourceMediaId : string | null;        // original Media.Asset guid — null for embedded/cdn-only
    readonly file          : string | null;        // relative zip path (assets/<id>.<ext>); null if embedded/cdn-only
    readonly cdnUrl        : string | null;
    readonly embedded      : string | null;
}

/** Filename extension (no dot) per mime type, for naming zipped asset files; falls back to "bin". */
const EXT_BY_MIME : Record<string, string> =
{
    "image/png":     "png",
    "image/jpeg":     "jpg",
    "image/gif":      "gif",
    "image/webp":     "webp",
    "image/svg+xml":  "svg",
    "image/bmp":      "bmp",
    "image/heic":     "heic",
};

/** The zip-entry extension (no dot) for a mime type — a small fallback map since `Asset` carries no
 *  extension field of its own. */
export function extensionForMime( mimeType : string ) : string
{
    return EXT_BY_MIME[ mimeType ] ?? "bin";
}
