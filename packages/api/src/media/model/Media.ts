//
import { Type } from "@repo/common";
import { Access } from "@repo/endpoint";
import { Validation } from "../../model/Validation";

//
// Media — the account media plane's shared contract (the wire + index shape), modeled as an ENVELOPE
// (media-1 / media-22): an Asset is a PACKAGE with library metadata (name, tags, kind, ownership, provenance)
// and a set of ITEMS (media files) — the ORIGINAL plus all DERIVED media (renditions, compressions, extracted
// audio, posters, transcripts, generated variants). Bytes live in S3 (`acct/<accountId>/media/<guid>/
// <usage[.profile]>.<ext>`); this DynamoDB record is the source of truth (one row per envelope, items
// embedded). One model for every surface: upload, Browse import, AI Gen, transcode, transcribe, Studio.
//
export namespace Media
{
    /** A media family — the kind of a single file (an envelope's ORIGINAL, or any item). */
    export enum Kind
    {
        IMAGE    = "image",
        VIDEO    = "video",
        AUDIO    = "audio",
        DOCUMENT = "document",   // PDFs / text (transcripts, captions)
        OTHER    = "other",
    }

    /** Delivery tier — how the bytes are served (media-2.2). */
    export enum Tier
    {
        PUBLIC    = "public",       // CloudFront + OAC (no public bucket); endpoint hit only on cache miss
        PROTECTED = "protected",    // CDN-delivered but signed (signed URL / cookies)
        PRIVATE   = "private",      // authed endpoint → time-limited pre-signed URL; never streamed
    }

    /** Ingest → serve lifecycle (media-3.3). Used for an item's readiness AND the envelope rollup. */
    export enum Status
    {
        UPLOADING   = "uploading",     // presigned issued / placeholder — awaiting bytes
        SCANNING    = "scanning",      // uploaded; malware scan in progress (stub for now — media-5.1)
        PROCESSING  = "processing",    // clean; deriving items (renditions / transcode / generation)
        OK          = "ok",            // ready; servable
        FAILED      = "failed",        // processing/derivation error
        QUARANTINED = "quarantined",   // scan flagged it — never servable
        DELETED     = "deleted",       // soft-deleted; awaiting sweep
    }

    /** Who OWNS the envelope. ACCOUNT = the account library; USER = a user's avatar (bytes user-scoped in S3,
     *  follow the person). Campaign is NOT an owner — used by 0..N campaigns (see `campaignIds`). */
    export enum Scope
    {
        ACCOUNT = "account",
        USER    = "user",
    }

    /** The ROLE of an item within its envelope (media-1.3). A typed category; `Item.profile` names the specific
     *  one within a multi category (e.g. PLATFORM → "tiktok"/"youtube"; COMPRESSED → "mms"/"web-hd"). */
    export enum Usage
    {
        ORIGINAL   = "original",     // the source file (exactly one per envelope)
        DISPLAY    = "display",      // scaled render for display (profile = thumb/mobile/tablet/desktop)
        THUMBNAIL  = "thumbnail",    // a single small preview
        POSTER     = "poster",       // a still frame from a video
        COMPRESSED = "compressed",   // a size/target-compressed video (profile = mms/mobile/web-hd/…)
        DENSITY    = "density",      // an image re-rendered to a target DPI (profile = web/print/…)
        AUDIO      = "audio",        // an extracted audio track (from a video)
        TRANSCRIPT = "transcript",   // speech-to-text (a .srt/.vtt/.json document + timed segments in meta)
        PLATFORM   = "platform",     // a platform-specific rendition (profile = instagram/tiktok/youtube/…)
        GENERATED  = "generated",    // an AI-generated derivative within the envelope (e.g. image → AI video)
        RENDER     = "render",       // a Studio-produced output (profile = lowres/highres/…)
        CAPTIONED  = "captioned",    // a burned-in-caption VIDEO variant (profile identifies the transcript source + version)
        AVATAR     = "avatar",       // a square, cropped profile-photo rendition (profile = xl/lg/md/sm/xs)
    }

    /** How an envelope entered the library (media-15). `upload` = from a computer; `provider` = a Browse
     *  import; `generated` = AI-generated. */
    export enum SourceOrigin
    {
        UPLOAD    = "upload",
        PROVIDER  = "provider",
        GENERATED = "generated",
    }

    /** A rights/license descriptor — used by an imported envelope's `source` and by Browse results. */
    export enum LicenseType
    {
        CC0             = "cc0",
        CC_BY           = "cc-by",
        ROYALTY_FREE    = "royalty-free",
        RIGHTS_MANAGED  = "rights-managed",
        EDITORIAL       = "editorial",
        COMMERCIAL      = "commercial",
        CUSTOM          = "custom",
    }

    export interface License
    {
        type               : LicenseType;
        requiresAttribution : boolean;
        attributionText?   : string;
        url?               : string;      // link to the full license terms
    }

    /** Free or priced. `amount` is whole cents (minor units) in `currency` when priced. */
    export interface Cost { free : boolean; amount? : Type.Cents; currency? : Type.Currency; }

    /** Where the ENVELOPE came from (media-1.7) — the object's ORIGIN. For a GENERATED original the AI context
     *  (provider/model/prompt/params) is retained here so the source can be reproduced / re-tweaked. */
    export interface Source
    {
        origin      : SourceOrigin;
        provider?   : string;             // Browse.Provider / AiRouting.Provider value (provider|generated)
        externalId? : string;             // the provider's asset id
        sourceUrl?  : string;             // link to the asset on the provider
        license?    : License;
        cost?       : Cost;
        acquiredAt? : Type.ISODateTime;   // when imported/generated
        acquiredBy? : Type.UUID;          // the user who acquired it
        orderId?    : string;             // purchase order/receipt reference (priced acquisitions)
        model?      : string;             // the AI model (generated original)
        prompt?     : string;             // the generation prompt (generated) — retained for reproducibility
        params?     : Record<string, unknown>;   // the normalized generation attributes (generated)
        batchId?    : string;             // groups the candidate solutions of one generate request (generated)
    }

    /** How a DERIVED item was produced (media-1.7) — retained so it can be reproduced / re-run / tweaked.
     *  For AI derivations (e.g. image → AI video) it holds the provider/model/prompt/params AND `sourceItemId`,
     *  the item this was derived FROM — so the chain + history are never lost. */
    export interface Derivation
    {
        job          : string;                    // the producing operation: "process" | "poster" | "transcribe" | "compress" | "generate" | "render"
        sourceItemId? : string;                   // the item this was derived from (default: the ORIGINAL)
        provider?    : string;                    // AI provider (AI-derived)
        model?       : string;                    // AI model (AI-derived)
        prompt?      : string;                    // AI prompt (AI-derived) — retained to tweak + regenerate
        params?      : Record<string, unknown>;   // normalized attributes / job params
        producedAt?  : Type.ISODateTime;
    }

    /** One timed line of a transcript — `start`/`end` are seconds offsets into the audio. */
    export interface TranscriptSegment { start : number; end : number; text : string; }

    /** A speech-to-text transcript (media-18) — held in a TRANSCRIPT item's `meta` (+ an .srt/.vtt/.json file). */
    export interface Transcript
    {
        text      : string;                        // the full transcript
        segments  : Array<TranscriptSegment>;      // timed lines (empty if the provider gave no timestamps)
        language? : string;                        // detected/echoed BCP-47 language
        provider? : string;                        // the STT provider (e.g. "openai")
        model?    : string;                        // the STT model (e.g. "whisper-1")
        createdAt? : Type.ISODateTime;
    }

    /** Probed metadata for an IMAGE (sharp). Optional beyond width/height so an un-probed format degrades. */
    export interface ImageMeta
    {
        width      : number;
        height     : number;
        format?    : string;     // "jpeg" | "png" | "webp" | "gif" | "svg" | …
        space?     : string;     // "srgb" | "cmyk" | "b-w" | …
        channels?  : number;
        depth?     : string;
        density?   : number;     // DPI
        hasAlpha?  : boolean;
        orientation? : number;   // EXIF orientation (1–8)
        pages?     : number;     // frame/page count
    }

    /** Probed metadata for a VIDEO (ffprobe). All optional so partial probes still store. */
    export interface VideoMeta
    {
        width?       : number;
        height?      : number;
        durationSec? : number;
        frameRate?   : number;
        videoCodec?  : string;
        audioCodec?  : string;
        bitrate?     : number;
        pixelFormat? : string;
        rotation?    : number;
        container?   : string;
    }

    /** Probed metadata for AUDIO. */
    export interface AudioMeta
    {
        durationSec? : number;
        bitrate?     : number;   // bits/sec
        sampleRate?  : number;   // Hz
        channels?    : number;
        codec?       : string;
    }

    /** Metadata for a DOCUMENT/text item (incl. a transcript). */
    export interface DocumentMeta
    {
        pages?      : number;
        length?     : number;        // character count (text)
        transcript? : Transcript;    // for a TRANSCRIPT item
    }

    /** An item's per-kind metrics — a bag keyed by the item's `kind` (only the matching one is populated;
     *  tolerant of partial probes / older rows). */
    export interface ItemMeta
    {
        image?    : ImageMeta;
        video?    : VideoMeta;
        audio?    : AudioMeta;
        document? : DocumentMeta;
    }

    /** A file inside an envelope (media-1.2) — the ORIGINAL or a derived item. Keyed within the envelope by
     *  `(usage, profile)` (see {@link itemKey}). `versionId` is the CURRENT S3 object version (media-1.4 —
     *  S3 versioning keeps history; the user can list versions + revert). */
    export interface Item
    {
        id          : Type.UUID;          // stable item id within the envelope
        usage       : Usage;
        profile?    : string;             // discriminator within a multi usage ("tiktok" | "mms" | "mobile" | …)
        kind        : Kind;               // the item's OWN media kind
        mime        : string;
        extension   : string;             // no leading dot
        size        : number;
        version     : number;             // bumps on replace/re-run
        versionId?  : string;             // the current S3 object version id (for revert)
        status      : Status;             // per-item readiness (derivations complete independently)
        meta?       : ItemMeta;
        derivation? : Derivation;         // set for derived/generated items
        createdAt   : Type.ISODateTime;
        modifiedAt  : Type.ISODateTime;
    }

    /** One stored S3 version of an item's bytes (media-1.4) — the history the UI lists so a user can revert
     *  to an earlier version. `versionId` is the S3 object version; `isLatest` marks the current one. */
    export interface ItemVersion
    {
        versionId    : string;
        size         : number;
        lastModified : Type.ISODateTime;
        isLatest     : boolean;
    }

    /** Lifecycle of a download archive (media-20). */
    export enum ArchiveStatus
    {
        PENDING    = "pending",
        PROCESSING = "processing",
        COMPLETE   = "complete",
        ERROR      = "error",
    }

    /** A download archive (media-20) — a zip of an envelope's items, in its own table with a TTL. */
    export interface Archive
    {
        accountId    : string;
        archiveId    : string;
        name         : string;
        status       : ArchiveStatus;
        sourceGuids  : Array<string>;
        size?        : number;
        error?       : string;
        requestedBy? : Type.UUID;
        createdAt    : Type.ISODateTime;
        expiresAt?   : Type.ISODateTime;
        ttl?         : number;
    }

    /** A cloned voice (media-21) — account-scoped synthetic voice; its own table. */
    export interface Voice
    {
        accountId  : string;
        voiceId    : string;
        name       : string;
        provider   : string;
        sourceGuid? : string;
        createdBy? : Type.UUID;
        createdAt  : Type.ISODateTime;
    }

    /** A variant TEMPLATE — the config-side target the processor renders DISPLAY/PLATFORM items to. A named
     *  profile (e.g. "instagram") is an array of these, matched to a source by `mime`. */
    export interface VariantSpec
    {
        mime      : string;      // SOURCE matcher: "image/*" | "video/*" | "image/png"
        label?    : string;      // the item's `profile` (e.g. "thumb" | "instagram.feed")
        width?    : number;
        height?   : number;
        fit?      : "cover" | "contain" | "fit";
        format?   : "jpeg" | "png" | "webp" | "mp4";
        maxBytes? : number;
        quality?  : number;
    }

    /** A normalized crop rectangle — fractions (0..1) of the source width/height. Used to frame a square avatar
     *  from its original photo (pan/zoom under a circular overlay); stored so the framing is re-editable and the
     *  variants are reproducible. */
    export interface CropRect { x : number; y : number; w : number; h : number; }

    /** The avatar variant sizes (profile keys), largest → smallest. A closed set → the widget's `size` prop. */
    export enum AvatarSize { XL = "xl", LG = "lg", MD = "md", SM = "sm", XS = "xs" }

    /** The result of a malware scan on an envelope's ORIGINAL bytes (media-5) — persisted so the UI can show
     *  what was scanned, by which engine, when, and the outcome (clean / threat / advanced-unscanned). */
    export interface ScanResult
    {
        clean      : boolean;              // true = no threat detected (or fail-open advanced it unscanned)
        provider   : string;              // the scan provider id (MediaConfig.ScanProvider — e.g. "clamav" / "none")
        engine?    : string;              // engine / signature-db detail reported by the scanner
        threat?    : string;              // the detected threat name (when !clean)
        failOpen?  : boolean;             // true = the engine was unavailable and config let it advance UNSCANNED
        scannedAt  : Type.ISODateTime;    // when the scan ran
    }

    /** The media ENVELOPE (DynamoDB `media`: PK accountId, SK guid) — the library object + its items. */
    export interface Asset
    {
        accountId    : Type.UUID;          // partition owner (acting account; avatars indexed here too)
        guid         : Type.UUID;          // the envelope id (SK) — the S3 mediaId
        name         : string;             // display name of the object
        kind         : Kind;               // = the ORIGINAL item's kind (denormalized for list/filter)
        tier         : Tier;
        accessRole   : Access.Role;         // minimum role to access a protected/private envelope
        status       : Status;             // rollup — the original's readiness gates delivery
        scanThreat?  : string;             // the detected threat name when status is QUARANTINED (media-5)
        scan?        : ScanResult;         // the last malware-scan result on the ORIGINAL bytes (media-5) — shown in Info
        scope        : Scope;              // ACCOUNT (library) | USER (avatar) — the OWNER
        scopeId?     : Type.UUID;          // the userId, for a USER/avatar envelope
        avatarCrop?  : CropRect;           // the framing (normalized) the AVATAR variants are cropped to (USER scope)
        campaignIds  : Array<string>;      // 0..N campaigns using this — a denormalized FILTER (SoT = campaign)
        tags         : Array<string>;
        source?      : Source;             // the envelope's ORIGIN provenance (upload | provider | generated)
        items        : Array<Item>;        // the ORIGINAL + all derived media
        createdBy?   : Type.UUID;          // the user who created/uploaded it
        createdAt    : Type.ISODateTime;
        modifiedAt   : Type.ISODateTime;
        lastAccessedAt? : Type.ISODateTime;
        deletedAt?   : Type.ISODateTime;
        ttl?         : number;             // DynamoDB TTL (epoch seconds)
    }

    // ── Helpers ──────────────────────────────────────────────────────────────────────────────────
    /** The unique key of an item within an envelope: `usage` or `usage.profile`. */
    export function itemKey( usage : Usage, profile? : string ) : string { return profile ? `${ usage }.${ profile }` : usage; }

    /** The ORIGINAL item of an envelope (the source file), or undefined for an empty envelope. */
    export function originalItem( asset : Asset ) : Item | undefined { return ( asset.items ?? [] ).find( ( item ) => item.usage === Usage.ORIGINAL ); }

    /** Find an item by `(usage, profile)`. */
    export function findItem( asset : Asset, usage : Usage, profile? : string ) : Item | undefined
    {
        const key : string = itemKey( usage, profile );
        return ( asset.items ?? [] ).find( ( item ) => itemKey( item.usage, item.profile ) === key );
    }

    /** Upsert an item into an envelope's items by `(usage, profile)` — REPLACES the current one (bumping its
     *  `version`) or appends a new one. Returns the new items array (pure). */
    export function upsertItems( items : Array<Item>, next : Item ) : Array<Item>
    {
        const key : string = itemKey( next.usage, next.profile );
        const prior : Item | undefined = items.find( ( item ) => itemKey( item.usage, item.profile ) === key );
        const merged : Item = prior ? { ...next, id: prior.id, version: prior.version + 1 } : next;
        return [ ...items.filter( ( item ) => itemKey( item.usage, item.profile ) !== key ), merged ];
    }

    /** Whether a usage may occur more than once (0-N) in an envelope (else it is single). */
    export interface UsageRule { usage : Usage; multi : boolean; }

    /** Valid item usages per ORIGINAL kind (media-1.3) — drives validation + the UI. `ORIGINAL` is implicit. */
    export const USAGE_CATALOG : Partial<Record<Kind, ReadonlyArray<UsageRule>>> =
    {
        [ Kind.IMAGE ]: [
            { usage: Usage.DISPLAY, multi: true }, { usage: Usage.THUMBNAIL, multi: false },
            { usage: Usage.DENSITY, multi: true }, { usage: Usage.PLATFORM, multi: true },
            { usage: Usage.GENERATED, multi: true },
        ],
        [ Kind.VIDEO ]: [
            { usage: Usage.COMPRESSED, multi: true }, { usage: Usage.AUDIO, multi: false },
            { usage: Usage.TRANSCRIPT, multi: false }, { usage: Usage.POSTER, multi: false },
            { usage: Usage.PLATFORM, multi: true }, { usage: Usage.GENERATED, multi: true },
            { usage: Usage.CAPTIONED, multi: true },
        ],
        [ Kind.AUDIO ]: [
            { usage: Usage.TRANSCRIPT, multi: false }, { usage: Usage.COMPRESSED, multi: true },
            { usage: Usage.GENERATED, multi: true },
        ],
    };

    /** The default generic-DISPLAY profiles the processor derives for images (widths in px; height auto). */
    export const DISPLAY_VARIANTS : ReadonlyArray<VariantSpec> =
    [
        { mime: "image/*", label: "thumb",   width: 256 },
        { mime: "image/*", label: "mobile",  width: 640 },
        { mime: "image/*", label: "tablet",  width: 1024 },
        { mime: "image/*", label: "desktop", width: 1600 },
    ];

    /** The square AVATAR profiles the processor derives from the (cropped) original — large → very small.
     *  `label` = the {@link AvatarSize} profile key; both dims set + cover so every rendition is a square. */
    export const AVATAR_VARIANTS : ReadonlyArray<VariantSpec> =
    [
        { mime: "image/*", label: AvatarSize.XL, width: 512, height: 512, fit: "cover", format: "png" },
        { mime: "image/*", label: AvatarSize.LG, width: 256, height: 256, fit: "cover", format: "png" },
        { mime: "image/*", label: AvatarSize.MD, width: 128, height: 128, fit: "cover", format: "png" },
        { mime: "image/*", label: AvatarSize.SM, width: 64,  height: 64,  fit: "cover", format: "png" },
        { mime: "image/*", label: AvatarSize.XS, width: 32,  height: 32,  fit: "cover", format: "png" },
    ];

    // ── Read-time DEFAULT (schema tolerance) — safe baseline; identity fields omitted ────────────────
    export const DEFAULT : Partial<Asset> =
    {
        kind:       Kind.OTHER,
        tier:       Tier.PROTECTED,
        accessRole: Access.AccountRole.USER,
        status:      Status.UPLOADING,
        scope:       Scope.ACCOUNT,
        tags:        [],
        campaignIds: [],
        items:       [],
    };

    // ── Schema + validator (shared: service / web / Console) ────────────────────────────────────
    export const SCHEMA : Validation.Schema =
    {
        $schema: "http://json-schema.org/draft-07/schema#",
        type: "object", additionalProperties: true,
        required: [ "accountId", "guid", "name", "kind", "tier", "accessRole", "status", "scope", "tags", "campaignIds", "items", "createdAt", "modifiedAt" ],
        properties:
        {
            accountId:  { type: "string" },
            guid:       { type: "string" },
            name:       { type: "string" },
            kind:       { type: "string", enum: Object.values( Kind ) },
            tier:       { type: "string", enum: Object.values( Tier ) },
            accessRole: { type: "string" },
            status:     { type: "string", enum: Object.values( Status ) },
            scope:       { type: "string", enum: Object.values( Scope ) },
            scopeId:     { type: "string" },
            campaignIds: { type: "array", items: { type: "string" } },
            tags:        { type: "array", items: { type: "string" } },
            items:       { type: "array" },
            createdAt:  { type: "string" },
            modifiedAt: { type: "string" },
        },
    };

    /** JSON Schema validator for `Asset`. */
    export const validate : Validation.Validator<Asset> = Validation.compile<Asset>( SCHEMA );
}

export default Media;
