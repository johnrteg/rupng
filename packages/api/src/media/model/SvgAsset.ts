//
// SvgAsset — a single reusable SVG graphic (icon/logo/clipart) placeable onto any SVG editor page. NOT an
// SvgTemplate (a whole starting-point document) and NOT a Media.Asset (the general raster/video library) —
// its own `svg-assets` DynamoDB table + S3 prefix, in two scopes (SYSTEM = platform-provided, read-only;
// ACCOUNT = an account's own uploads/imports), mirroring SvgTemplate's owner-partition pattern. The markup
// itself is sanitized before storage; placing one on a page copies its markup inline into the doc (see
// SvgDocument.Asset.embedded) rather than referencing it live, so a doc keeps rendering even if the library
// entry is later removed.
//
export namespace SvgAsset
{
    /** Who owns/sees an SVG asset — platform-global (read-only to regular users) or a single account's own. */
    export enum Scope
    {
        SYSTEM  = "system",
        ACCOUNT = "account",
    }

    /** Where the markup came from — a direct upload or a Browse provider import (icon/logo catalogs). */
    export enum SourceKind
    {
        UPLOAD   = "upload",
        PROVIDER = "provider",
    }

    /** The full asset record (DynamoDB row) — metadata + the S3 key of its (sanitized) markup + thumbnail. */
    export interface Entity
    {
        readonly id           : string;
        readonly scope        : Scope;
        readonly accountId    : string | null;   // null for system assets
        readonly name         : string;
        readonly svgKey       : string;           // S3 key of the sanitized SVG markup
        readonly thumbnailKey : string | null;    // S3 key of a rendered thumbnail (later phase; null until generated)
        readonly tags         : Array<string>;
        readonly source       : SourceKind;
        readonly provider?    : string;           // Browse.Provider id, when source = PROVIDER
        readonly createdAt    : number;
        readonly updatedAt    : number;
    }

    /** The list-response projection — the Entity WITHOUT svgKey (the markup body isn't needed to browse). */
    export interface Summary
    {
        readonly id           : string;
        readonly scope        : Scope;
        readonly accountId    : string | null;
        readonly name         : string;
        readonly thumbnailKey : string | null;
        readonly tags         : Array<string>;
        readonly source       : SourceKind;
        readonly createdAt    : number;
        readonly updatedAt    : number;
    }

    /** Shared create-request shape — either raw markup (`svg`) OR a Browse provider pick (`provider` +
     *  `externalId`), never both. Reused by both the account-scoped and the root system-scoped create
     *  endpoints (they differ only in which `owner` partition the resulting row lands in). */
    export interface CreateBody
    {
        name        : string;
        tags?       : Array<string>;
        svg?        : string;      // raw SVG markup — required when importing by direct upload
        provider?   : string;      // Browse.Provider id (SVGL | ICONIFY) — required when importing from a provider
        externalId? : string;      // required alongside `provider`
    }

    /** Why an upload's RAW markup was rejected outright rather than sanitized-and-stored (SvgThreatScanner,
     *  apps/core/media). Each value is a genuine attack vector with no legitimate reuse case — distinct from
     *  the constructs SvgSanitizer re-legitimizes (same-document `<use>`/gradient `xlink:href`, `<style>`). */
    export enum RejectReason
    {
        SCRIPT               = "script",                // a <script> element
        EVENT_HANDLER        = "event_handler",          // an on* attribute (onload, onclick, …)
        EXTERNAL_REFERENCE   = "external_reference",     // <foreignObject>/<iframe>/<image>, or href/xlink:href with a scheme/host
        EXTERNAL_STYLESHEET  = "external_stylesheet",    // @import, or a CSS url() that isn't a same-document fragment
    }

    /** Carried on a failed `SvgAssetService.create()` Result's `cause` when the raw markup was rejected and
     *  quarantined rather than sanitized-and-stored — lets the caller distinguish this from an infra failure
     *  (S3/DDB) and respond 400 with the reasons, instead of 500. See SvgAsset.isQuarantineRejection(). */
    export interface QuarantineRejection
    {
        readonly quarantined : true;
        readonly reasons     : Array<RejectReason>;
    }

    /** Narrows an unknown `Type.Result` `cause` down to a QuarantineRejection. */
    export function isQuarantineRejection( cause : unknown ) : cause is QuarantineRejection
    {
        return typeof cause === "object" && cause !== null && ( cause as { quarantined? : unknown } ).quarantined === true;
    }

    /** The quarantine DynamoDB row (`svg-asset-quarantine` table) — the rejected raw markup's metadata + S3
     *  key + why it was rejected. TTL (`ttl`, epoch seconds) auto-expires the row (and its lifecycle-ruled S3
     *  object) after a review window; nothing actively sweeps it, matching this repo's TTL-table convention. */
    export interface QuarantineEntity
    {
        readonly owner     : string;             // same owner-partition convention as Entity (SYSTEM_OWNER or accountId)
        readonly id        : string;
        readonly accountId : string | null;      // null for a system-scope attempt
        readonly name      : string;
        readonly reasons   : Array<RejectReason>;
        readonly svgKey    : string;             // S3 key of the untouched raw markup, under the media-staging bucket
        readonly createdAt : number;
        readonly ttl       : number;             // epoch seconds
    }
}

export default SvgAsset;
// eof
