//
// MediaConfig — the media service's runtime configuration (its AppConfig `config/settings` profile): non-secret
// operational policy tunable WITHOUT a redeploy — upload limits, variant profiles, delivery TTLs, lifecycle
// windows, the scan switch, and API throttle. Lives in @repo/api (one definition) so the service reads it live
// + seeds `DEFAULT`, the Console's AppConfig editor lints against `SCHEMA`, and an admin UI validates.
//
// NOT here: plan/storage QUOTA (that's account `ResolvedEntitlements`) and any secrets (Secrets Manager).
//
import { Media } from "./Media";
import { Validation } from "../../model/Validation";

export namespace MediaConfig
{
    /** Upload validation + presign (media-3). */
    export interface Upload
    {
        maxSizeMb       : number;                              // global cap; a per-kind override below wins
        maxSizeMbByKind : Partial<Record<Media.Kind, number>>; // e.g. image 25, video 500, document 20
        allowedMime     : Array<string>;                      // allow-list of mime matchers ("image/*"…); empty = allow any
        presignTtlSec   : number;                             // upload URL lifetime
    }

    /** Variant policy (media-4). `profiles` is name → specs; the generic `display` profile is media's own,
     *  platform profiles (e.g. "instagram") are seeded/owned by their consumer (social). */
    export interface Variants
    {
        strategy : "preprocess" | "ondemand";                 // pre-generate all, or derive at the edge on first request
        profiles : Record<string, Array<Media.VariantSpec>>;
    }

    /** Delivery hand-off (media-2). */
    export interface Delivery
    {
        signedUrlTtlSec : number;                             // GET (preview/download) URL lifetime
        defaultTier     : Media.Tier;                         // when the uploader doesn't specify
    }

    /** Lifecycle & cost (media-6). */
    export interface Lifecycle
    {
        glacierAfterDays    : number;                         // lastAccessedAt threshold → cold tier
        softDeleteSweepDays : number;                         // DELETED → purge bytes
        defaultTtlDays      : number;                         // 0 = no auto-expiry
    }

    /** The malware-scan engine an upload is checked against (media-5). A closed set — one adapter per value
     *  in the service's MalwareScanFactory. `none` = the pass-through stub (no real scan). */
    export enum ScanProvider
    {
        NONE      = "none",       // no real scan (dev stub) — pass-through
        CLAMAV    = "clamav",     // ClamAV signature engine (clamd), via the `clamscan` npm
        HEURISTIC = "heuristic",  // zero-infra magic-byte / extension checks (first-line, not full AV)
    }

    /** ClamAV connection (media-5) — how the ClamAV adapter reaches `clamd` (a daemon/sidecar/container). */
    export interface ClamdConnection { host : string; port : number; timeoutMs? : number; }

    /** Security scan policy (media-5). `enabled` gates whether uploads are scanned at all; `provider` picks the
     *  engine; `failClosed` keeps a file in SCANNING (redeliver) when the engine is unreachable rather than
     *  auto-passing it; `clamd` configures the ClamAV adapter's connection. */
    export interface Scan
    {
        enabled    : boolean;
        provider   : ScanProvider;
        failClosed : boolean;
        clamd?     : ClamdConnection;
    }

    /** API throttle (media-7.2) — bandwidth caps stay at the gateway; storage quota = account entitlements. */
    export interface Limits { apiRatePerMinute : number; }

    /** Auto-tagging on process — a vision model (via @repo/ai) suggests tags for IMAGE assets. Off by
     *  default (needs an AI key: OPENAI_API_KEY / Secrets). */
    export interface AutoTag { enabled : boolean; maxTags : number; }

    /** Download archives (media-20) — the zip retention window; a generated zip is swept (S3 + record) after
     *  `ttlDays` so downloads don't accumulate. */
    export interface Downloads { ttlDays : number; }

    /** Video codec for a compression target (media-10.10). H.264 = max compatibility (MMS/older); HEVC =
     *  smaller at equal quality where supported (patent licensing — media-10.9). */
    export enum VideoCodec { H264 = "h264", HEVC = "hevc" }

    /** A named video-compression distribution target (media-10.10) — the goal the MediaVideoJob encodes to.
     *  A `maxSizeKb` goal drives the CRF quality ladder; the others cap dimensions / duration / audio. */
    export interface VideoTarget
    {
        label      : string;              // display name for the picker
        codec      : VideoCodec;
        maxWidth?  : number;              // scale down to this width (keep aspect)
        maxSizeKb? : number;              // hard size cap → CRF ladder stops at the first under it
        maxSeconds? : number;            // trim / reject beyond this (MMS)
        fpsCap?    : number;              // cap frame rate for size
        audioKbps? : number;              // downmix audio bitrate
    }

    /** A DPI/density target for an image density variant (media-4) — e.g. `{ label: "Web", dpi: 72 }`,
     *  `{ label: "Print", dpi: 300 }`. `upscale` (default true) resamples pixels UP when the source is below
     *  the target so the physical print size is preserved at the higher DPI (never downscales for density). */
    export interface DensityTarget { label : string; dpi : number; upscale? : boolean; }

    export interface Config
    {
        upload    : Upload;
        variants  : Variants;
        delivery  : Delivery;
        lifecycle : Lifecycle;
        scan         : Scan;
        limits       : Limits;
        autoTag      : AutoTag;
        downloads    : Downloads;
        videoTargets : Record<string, VideoTarget>;   // named compression targets (media-10.10)
        densities    : Record<string, DensityTarget>;  // named DPI targets for image density variants (media-4)
    }

    // ── Schema + validator (shared: service / web / Console) ────────────────────────────────────
    export const SCHEMA : Validation.Schema =
    {
        $schema: "http://json-schema.org/draft-07/schema#",
        type: "object", additionalProperties: false,
        required: [ "upload", "variants", "delivery", "lifecycle", "scan", "limits", "autoTag", "downloads", "videoTargets" ],
        properties:
        {
            upload: {
                type: "object", additionalProperties: false,
                required: [ "maxSizeMb", "maxSizeMbByKind", "allowedMime", "presignTtlSec" ],
                properties: {
                    maxSizeMb:       { type: "number", minimum: 1 },
                    maxSizeMbByKind: { type: "object", additionalProperties: { type: "number", minimum: 1 } },
                    allowedMime:     { type: "array", items: { type: "string" } },
                    presignTtlSec:   { type: "number", minimum: 1 },
                },
            },
            variants: {
                type: "object", additionalProperties: false,
                required: [ "strategy", "profiles" ],
                properties: {
                    strategy: { type: "string", enum: [ "preprocess", "ondemand" ] },
                    profiles: { type: "object", additionalProperties: { type: "array" } },   // name → VariantSpec[] (lenient on spec internals)
                },
            },
            delivery: {
                type: "object", additionalProperties: false,
                required: [ "signedUrlTtlSec", "defaultTier" ],
                properties: {
                    signedUrlTtlSec: { type: "number", minimum: 1 },
                    defaultTier:     { type: "string", enum: Object.values( Media.Tier ) },
                },
            },
            lifecycle: {
                type: "object", additionalProperties: false,
                required: [ "glacierAfterDays", "softDeleteSweepDays", "defaultTtlDays" ],
                properties: {
                    glacierAfterDays:    { type: "number", minimum: 0 },
                    softDeleteSweepDays: { type: "number", minimum: 0 },
                    defaultTtlDays:      { type: "number", minimum: 0 },
                },
            },
            scan:   { type: "object", additionalProperties: false, required: [ "enabled", "provider", "failClosed" ], properties: {
                        enabled:    { type: "boolean" },
                        provider:   { type: "string", enum: Object.values( ScanProvider ) },
                        failClosed: { type: "boolean" },
                        clamd:      { type: "object", additionalProperties: false, required: [ "host", "port" ], properties: {
                                        host: { type: "string" }, port: { type: "number" }, timeoutMs: { type: "number", minimum: 0 } } },
                    } },
            limits: { type: "object", additionalProperties: false, required: [ "apiRatePerMinute" ], properties: { apiRatePerMinute: { type: "number", minimum: 1 } } },
            autoTag: { type: "object", additionalProperties: false, required: [ "enabled", "maxTags" ], properties: { enabled: { type: "boolean" }, maxTags: { type: "number", minimum: 1 } } },
            downloads: { type: "object", additionalProperties: false, required: [ "ttlDays" ], properties: { ttlDays: { type: "number", minimum: 1 } } },
            videoTargets: {
                type: "object",
                additionalProperties: {
                    type: "object", additionalProperties: false, required: [ "label", "codec" ],
                    properties: {
                        label:      { type: "string" },
                        codec:      { type: "string", enum: Object.values( VideoCodec ) },
                        maxWidth:   { type: "number", minimum: 1 },
                        maxSizeKb:  { type: "number", minimum: 1 },
                        maxSeconds: { type: "number", minimum: 1 },
                        fpsCap:     { type: "number", minimum: 1 },
                        audioKbps:  { type: "number", minimum: 1 },
                    },
                },
            },
            // named DPI targets for image density variants (media-4) — optional so older configs tolerate drift
            densities: {
                type: "object",
                additionalProperties: {
                    type: "object", additionalProperties: false, required: [ "label", "dpi" ],
                    properties: {
                        label:   { type: "string" },
                        dpi:     { type: "number", minimum: 1 },
                        upscale: { type: "boolean" },
                    },
                },
            },
        },
    };

    /** JSON Schema validator for `Config`. */
    export const validate : Validation.Validator<Config> = Validation.compile<Config>( SCHEMA );

    // ── Seeded defaults (the DEFAULT the service seeds + falls back to) ──────────────────────────
    export const DEFAULT : Config =
    {
        upload:    {
            maxSizeMb: 25,
            maxSizeMbByKind: { [ Media.Kind.IMAGE ]: 25, [ Media.Kind.VIDEO ]: 500, [ Media.Kind.AUDIO ]: 20, [ Media.Kind.DOCUMENT ]: 20 },
            allowedMime: [],                 // [] = allow any
            presignTtlSec: 900,
        },
        variants:  {
            strategy: "preprocess",
            profiles: { display: [ ...Media.DISPLAY_VARIANTS ] },   // platform profiles (social) are added here later
        },
        delivery:  { signedUrlTtlSec: 900, defaultTier: Media.Tier.PROTECTED },
        lifecycle: { glacierAfterDays: 180, softDeleteSweepDays: 30, defaultTtlDays: 0 },
        scan:      { enabled: false, provider: ScanProvider.NONE, failClosed: true, clamd: { host: "localhost", port: 3310, timeoutMs: 30000 } },   // stub gate until clamd is wired
        limits:    { apiRatePerMinute: 120 },
        autoTag:   { enabled: false, maxTags: 12 },   // vision auto-tagging off until an AI key is configured
        downloads: { ttlDays: 7 },                    // generated download zips are swept after a week
        videoTargets: {                               // named compression targets (media-10.10)
            "mms":     { label: "MMS (small)",      codec: VideoCodec.H264, maxWidth: 480,  maxSizeKb: 750, maxSeconds: 45, fpsCap: 15, audioKbps: 24 },
            "mobile":  { label: "Mobile / chat",    codec: VideoCodec.H264, maxWidth: 720,  audioKbps: 96 },
            "web-sd":  { label: "Web (SD)",         codec: VideoCodec.H264, maxWidth: 480,  audioKbps: 96 },
            "web-hd":  { label: "Web (HD)",         codec: VideoCodec.H264, maxWidth: 1080, audioKbps: 128 },
            "hevc-hd": { label: "HEVC (HD, small)", codec: VideoCodec.HEVC, maxWidth: 1080, audioKbps: 128 },
        },
        densities: {                                  // named DPI targets for image density variants (media-4)
            "web":   { label: "Web (72 dpi)",   dpi: 72,  upscale: false },
            "print": { label: "Print (300 dpi)", dpi: 300, upscale: true },
        },
    };
}

export default MediaConfig;
