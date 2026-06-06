//
// MediaConvert facade — submit transcode jobs, keyed by cloud-spec LOGICAL mediaConvert keys.
//
import {
    MediaConvertClient, DescribeEndpointsCommand, CreateJobCommand, GetJobCommand, ListPresetsCommand,
    ContainerType, VideoCodec, AudioCodec,
} from "@aws-sdk/client-mediaconvert";
import type {
    CreateJobCommandInput, DescribeEndpointsCommandOutput, CreateJobCommandOutput,
    GetJobCommandOutput, ListPresetsCommandOutput, Job, Output, Preset,
} from "@aws-sdk/client-mediaconvert";
import type { CloudResolver, ResourceKey } from "@repo/cloud-spec";
import { ClientUtils } from "./ClientUtils";

/**
 * The subset of video codec settings the inline encode builder fills — fields shared by H.264 and
 * H.265 (so the same object feeds either). String literals stay narrow so they assign to the SDK's
 * `H264Settings` / `H265Settings` without casts.
 */
interface VideoRateSettings
{
    RateControlMode       : "CBR" | "QVBR";
    Bitrate?              : number;
    MaxBitrate?           : number;
    QvbrSettings?         : { QvbrQualityLevel : number };
    FramerateControl?     : "SPECIFIED";
    FramerateNumerator?   : number;
    FramerateDenominator? : number;
}

/**
 * MediaConvert facade — submit video transcode jobs over `@aws-sdk/client-mediaconvert`,
 * addressed by cloud-spec LOGICAL mediaConvert keys (e.g. `"transcode"`).
 *
 * Quirk: MediaConvert uses an **account-specific endpoint** that must be discovered once
 * (`DescribeEndpoints`) — so unlike the other facades the client is obtained **asynchronously**
 * via {@link client} (it bootstraps, discovers, then caches the real client). Job `Settings`
 * are large/complex — build them and pass through {@link createJob}, or use `.client` directly.
 *
 * The common case ("a file in S3 → transcoded file(s) in S3") is {@link transcode}: an input object,
 * a destination prefix, and one or more renditions — each is **either an inline `encode` recipe**
 * (name/value options, no magic strings) **or a `preset` name**. It returns a **job id** — transcoding
 * is async; you learn the outcome from a MediaConvert→EventBridge event (see "Progress & errors").
 *
 * @example Inline encode options (no preset strings) — 1080p + 720p H.264 MP4
 * ```ts
 * import { Service, MediaConvert } from "@repo/services";
 *
 * class MediaService extends Service {
 *     private _media? : MediaConvert;
 *     protected get media() : MediaConvert { return this._media ??= new MediaConvert( this.cloud ); }
 *
 *     async process( srcKey : string ) : Promise<string | undefined> {
 *         return this.media.transcode(
 *             "transcode",                          // logical mediaConvert (queue) key
 *             `s3://uploads/${srcKey}`,             // input object
 *             "s3://processed/output/",             // destination PREFIX
 *             { outputs: [
 *                 { encode: { container: MediaConvert.Container.MP4, video: MediaConvert.Video.H264, height: 1080, qualityLevel: 8 }, nameModifier: "-1080p" },
 *                 { encode: { container: MediaConvert.Container.MP4, video: MediaConvert.Video.H264, height: 720 },                  nameModifier: "-720p"  },
 *                 // …or reference a preset by name instead of `encode`:
 *                 // { preset: "MyCustom-Hevc-1080p", nameModifier: "-hevc" },
 *             ] },
 *         );
 *     }
 * }
 * ```
 *
 * **Options — {@link MediaConvert.TranscodeOptions}:**
 * - **`outputs`** *(required)* — one rendition each; per rendition supply **one of**:
 *   - **`encode`** — inline {@link MediaConvert.EncodeOptions} (name/value, type-safe enums):
 *     `container` ({@link MediaConvert.Container}), `video` ({@link MediaConvert.Video}),
 *     `width`/`height`, `qualityLevel` (QVBR 1–10) **or** `bitrate` (CBR), `maxBitrate`, `fps`,
 *     `audio` ({@link MediaConvert.Audio}), `audioBitrate`. Covers MP4/MOV · H.264/H.265 · AAC.
 *   - **`preset`** — a preset name (system or custom). Discover the live, full list with
 *     {@link listPresets} rather than hard-coding strings.
 *   - **`nameModifier`** *(optional)* — output filename suffix (default derived); unique per rendition.
 * - **`role`** *(optional)* — MediaConvert IAM role ARN (defaults to `MEDIACONVERT_ROLE_ARN`).
 *
 * **Progress & errors (it's async — submit, don't wait):**
 * - {@link transcode}/{@link createJob} return a **job id** immediately; the job runs in the background.
 * - MediaConvert emits an **EventBridge** "MediaConvert Job State Change" event on
 *   `PROGRESSING` / `COMPLETE` / `ERROR` (with `errorCode`/`errorMessage` on failure) — route it via the
 *   incoming-event pipeline to a worker (and to analytics). This is how you react to completion/failure.
 * - To poll/inspect a single job directly, use {@link getJob} (`Status`, `JobPercentComplete`,
 *   `ErrorCode`, `ErrorMessage`). Errors also land in **CloudWatch Logs** for the job.
 *
 * For HLS/DASH packaging, thumbnails, captions, clipping, or multiple inputs, build the full
 * `Settings` and use {@link createJob} instead.
 */
export class MediaConvert
{
    private _client? : MediaConvertClient;

    ////////////////////////////////////////////////////////////////////////////////////////
    /** @param cloud the owning service's resolver — maps logical mediaConvert keys to queue ARNs. */
    constructor( private readonly cloud : CloudResolver ) {}

    ////////////////////////////////////////////////////////////////////////////////////////
    /** Resolve a cloud-spec logical mediaConvert key (e.g. `"transcode"`) to its job-queue ARN. */
    queue( key : ResourceKey ) : string { return this.cloud.mediaConvertQueue( key ); }

    ////////////////////////////////////////////////////////////////////////////////////////
    /**
     * The `MediaConvertClient`, bound to this account's discovered endpoint. **Async** (and
     * cached) because MediaConvert requires per-account endpoint discovery before use — this is
     * the escape hatch for operations beyond {@link createJob}.
     */
    async client() : Promise<MediaConvertClient>
    {
        if( this._client === undefined )
        {
            const bootstrap : MediaConvertClient = ClientUtils.createClient( MediaConvertClient );
            const res : DescribeEndpointsCommandOutput = await bootstrap.send( new DescribeEndpointsCommand( {} ) );
            const url : string | undefined = res.Endpoints?.[ 0 ]?.Url;
            this._client = url ? ClientUtils.createClient( MediaConvertClient, { endpoint: url } ) : bootstrap;
        }
        return this._client;
    }

    ////////////////////////////////////////////////////////////////////////////////////////
    /**
     * Submit a transcode job to this queue.
     * @param queueKey logical mediaConvert key.
     * @param role     the MediaConvert IAM role ARN (it reads/writes the input/output S3 buckets).
     * @param settings the job spec (`CreateJobCommandInput["Settings"]` — inputs, output groups, …).
     * @returns the created job id.
     */
    async createJob( queueKey : ResourceKey, role : string, settings : CreateJobCommandInput[ "Settings" ] ) : Promise<string | undefined>
    {
        const client : MediaConvertClient = await this.client();
        const result : CreateJobCommandOutput = await client.send( new CreateJobCommand( { Queue: this.queue( queueKey ), Role: role, Settings: settings } ) );
        return result.Job?.Id;
    }

    ////////////////////////////////////////////////////////////////////////////////////////
    /**
     * High-level transcode — the common case: **one input file → one or more rendition files**.
     *
     * You provide the **input** S3 object, a **destination** S3 prefix, and one or more **presets**
     * (the "options" — each preset *is* the encode recipe: container + video/audio codec + resolution +
     * bitrate). Presets are defined once (a MediaConvert **system preset** like
     * `"System-Avc_16x9_1080p_29_97fps_8500kbps"`, or a custom one you create in CDK/console) and
     * referenced by name — so the verbose `Settings` stay out of your code. Multiple presets = multiple
     * renditions (e.g. 1080p + 720p) from the one input, each written under the destination with a
     * distinct name suffix.
     *
     * For full control (HLS/DASH packaging, multiple inputs, captions, clipping) build `Settings`
     * yourself and call {@link createJob}.
     *
     * @param queueKey    logical mediaConvert key.
     * @param input       the source object, `s3://bucket/key` — any MediaConvert-supported input
     *                    (MOV / MP4 / WEBM / AVI / MXF / …); the container is **auto-detected**.
     * @param destination the output **prefix**, `s3://bucket/path/` (the input name + each output's
     *                    `nameModifier` + extension are appended by MediaConvert).
     * @param opts        the presets to apply + IAM role (see {@link MediaConvert.TranscodeOptions}).
     * @returns the created job id.
     */
    async transcode( queueKey : ResourceKey, input : string, destination : string, opts : MediaConvert.TranscodeOptions ) : Promise<string | undefined>
    {
        const role : string | undefined = opts.role ?? process.env.MEDIACONVERT_ROLE_ARN;
        if( role === undefined || role === "" )
            throw new Error( "MediaConvert.transcode: no IAM role (pass opts.role or set MEDIACONVERT_ROLE_ARN)" );

        const settings : CreateJobCommandInput[ "Settings" ] = {
            Inputs: [ {
                FileInput      : input,
                TimecodeSource : "ZEROBASED",
                VideoSelector  : {},
                AudioSelectors : { "Audio Selector 1": { DefaultSelection: "DEFAULT" } },
            } ],
            OutputGroups: [ {
                Name                : "File Group",
                OutputGroupSettings : { Type: "FILE_GROUP_SETTINGS", FileGroupSettings: { Destination: destination } },
                Outputs             : opts.outputs.map( ( rendition, index ) => this.buildRendition( rendition, index ) ),
            } ],
        };

        return this.createJob( queueKey, role, settings );
    }

    ////////////////////////////////////////////////////////////////////////////////////////
    /** Fetch a job's current state — `Status` (SUBMITTED/PROGRESSING/COMPLETE/CANCELED/ERROR), `JobPercentComplete`, and on failure `ErrorCode`/`ErrorMessage`. */
    async getJob( jobId : string ) : Promise<Job | undefined>
    {
        const client : MediaConvertClient = await this.client();
        const result : GetJobCommandOutput = await client.send( new GetJobCommand( { Id: jobId } ) );
        return result.Job;
    }

    ////////////////////////////////////////////////////////////////////////////////////////
    /**
     * List available **presets** (the authoritative, live catalog — system + this account's custom
     * presets), one page. Use this to discover valid preset names instead of hard-coding strings;
     * paginate via `.client` for more.
     */
    async listPresets() : Promise<Array<Preset>>
    {
        const client : MediaConvertClient = await this.client();
        const result : ListPresetsCommandOutput = await client.send( new ListPresetsCommand( {} ) );
        return result.Presets ?? [];
    }

    ////////////////////////////////////////////////////////////////////////////////////////
    /** Turn one {@link MediaConvert.Rendition} into a MediaConvert `Output` — either a preset reference or inline encode settings. */
    private buildRendition( rendition : MediaConvert.Rendition, index : number ) : Output
    {
        if( rendition.preset !== undefined )
            return { Preset: rendition.preset, NameModifier: rendition.nameModifier ?? `-${rendition.preset}` };
        if( rendition.encode !== undefined )
            return this.buildEncodeOutput( rendition.encode, rendition.nameModifier ?? `-${index + 1}` );
        throw new Error( "MediaConvert.transcode: each output needs a `preset` or an `encode` recipe" );
    }

    ////////////////////////////////////////////////////////////////////////////////////////
    /** Build an `Output` from inline {@link MediaConvert.EncodeOptions} (MP4/MOV · H.264/H.265 · AAC). */
    private buildEncodeOutput( encode : MediaConvert.EncodeOptions, nameModifier : string ) : Output
    {
        const container : MediaConvert.Container = encode.container ?? MediaConvert.Container.MP4;
        const video     : MediaConvert.Video     = encode.video ?? MediaConvert.Video.H264;
        const audio     : MediaConvert.Audio     = encode.audio ?? MediaConvert.Audio.AAC;

        if( container !== MediaConvert.Container.MP4 && container !== MediaConvert.Container.MOV )
            throw new Error( `MediaConvert encode: container '${container}' not supported inline — use a preset or createJob` );
        if( video !== MediaConvert.Video.H264 && video !== MediaConvert.Video.H265 )
            throw new Error( `MediaConvert encode: video codec '${video}' not supported inline — use a preset or createJob` );
        if( audio !== MediaConvert.Audio.AAC )
            throw new Error( `MediaConvert encode: audio codec '${audio}' not supported inline — use a preset or createJob` );

        // QVBR (quality-driven, default) or CBR (when an explicit bitrate is given).
        const rate : VideoRateSettings = encode.bitrate !== undefined
            ? { RateControlMode: "CBR", Bitrate: encode.bitrate }
            : { RateControlMode: "QVBR", MaxBitrate: encode.maxBitrate ?? 5_000_000, QvbrSettings: { QvbrQualityLevel: encode.qualityLevel ?? 7 } };
        const framerate : Partial<VideoRateSettings> = encode.fps !== undefined
            ? { FramerateControl: "SPECIFIED", FramerateNumerator: encode.fps, FramerateDenominator: 1 }
            : {};
        const videoSettings : VideoRateSettings = { ...rate, ...framerate };

        // Friendly enums above; emit the SDK-native codes here.
        const isMp4  : boolean = container === MediaConvert.Container.MP4;
        const isH264 : boolean = video === MediaConvert.Video.H264;

        return {
            NameModifier      : nameModifier,
            ContainerSettings : { Container: isMp4 ? ContainerType.MP4 : ContainerType.MOV, ...( isMp4 ? { Mp4Settings: {} } : { MovSettings: {} } ) },
            VideoDescription  : {
                Width         : encode.width,
                Height        : encode.height,
                CodecSettings : isH264
                    ? { Codec: VideoCodec.H_264, H264Settings: videoSettings }
                    : { Codec: VideoCodec.H_265, H265Settings: videoSettings },
            },
            AudioDescriptions : [ {
                CodecSettings : { Codec: AudioCodec.AAC, AacSettings: { Bitrate: encode.audioBitrate ?? 96_000, CodingMode: "CODING_MODE_2_0" as const, SampleRate: 48_000 } },
            } ],
        };
    }
}

export namespace MediaConvert
{
    // Friendly enums for the inline encode recipe — clean keys (`H264`, not `H_264`) whose values are
    // the real MediaConvert codes, so they read well and stay correct. (For codecs/containers beyond
    // these, use a `preset`; discover the full live preset catalog with {@link MediaConvert.listPresets}.)

    /**
     * **Output** container for the inline `encode` path — MP4 or MOV (both carry H.264/H.265 + AAC).
     * NOTE: this is the *output*, not the input — MediaConvert **auto-detects the input** container
     * (MOV / MP4 / WEBM / AVI / MXF / …), so the source file's format is never configured here. WebM
     * (VP8/VP9 + Opus) or other outputs go through a `preset`; AVI is input-only (not a valid output).
     */
    export enum Container { MP4 = "MP4", MOV = "MOV" }
    /** Video codec. */
    export enum Video { H264 = "H_264", H265 = "H_265", AV1 = "AV1", VP9 = "VP9", PRORES = "PRORES" }
    /** Audio codec. */
    export enum Audio { AAC = "AAC", MP3 = "MP3", OPUS = "OPUS", FLAC = "FLAC", AC3 = "AC3", EAC3 = "EAC3" }

    /**
     * Inline encode recipe — name/value options instead of an opaque preset string. Covers the common
     * case (MP4/MOV · H.264/H.265 · AAC); for anything else use a preset or {@link MediaConvert.createJob}.
     */
    export interface EncodeOptions
    {
        container?    : Container;      // default MP4
        video?        : Video;          // default H264
        width?        : number;         // omit → keep source width
        height?       : number;         // omit → keep source height
        qualityLevel? : number;         // QVBR quality 1..10 (default 7) — used when `bitrate` is unset
        maxBitrate?   : number;         // QVBR ceiling, bits/s (default 5_000_000)
        bitrate?      : number;         // bits/s → switches to CBR (constant bitrate)
        fps?          : number;         // omit → inherit from source
        audio?        : Audio;          // default AAC
        audioBitrate? : number;         // bits/s (default 96_000)
    }

    /** One rendition: either a `preset` name OR an inline `encode` recipe, plus its filename suffix. */
    export interface Rendition
    {
        /** A MediaConvert preset name (system or custom) — the encode recipe by reference. */
        preset?       : string;
        /** …or build the output settings inline (no preset). Exactly one of `preset`/`encode`. */
        encode?       : EncodeOptions;
        /** Filename suffix appended to the input base name (default derived); unique per rendition. */
        nameModifier? : string;
    }

    /** Options for {@link MediaConvert.transcode}. */
    export interface TranscodeOptions
    {
        /** One or more renditions (presets and/or inline encodes) from the single input. */
        outputs : Array<Rendition>;
        /** The MediaConvert IAM role ARN (defaults to `MEDIACONVERT_ROLE_ARN`). */
        role?   : string;
    }
}
