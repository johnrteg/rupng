//
import { promises as fs } from "node:fs";
import { existsSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { randomUUID } from "node:crypto";

import type { FfprobeData, FfprobeStream } from "fluent-ffmpeg";

import { AiFactory, Ai } from "@repo/ai";
import { FileUtils, type Type } from "@repo/common";
import { Media, MediaConfig, StudioProject } from "@repo/api";

//
// MediaAnalyzer — probe an asset's ORIGINAL bytes for type-specific stats (media-4): IMAGE via `sharp`
// (in-memory, from the buffer), VIDEO via `ffprobe` (fluent-ffmpeg + the bundled ffprobe-static binary,
// which needs a real file, so we spool to a temp file and delete it). AUDIO / PDF are intentionally NOT
// analyzed yet. Native deps are lazy-imported so a missing/unbuilt binary degrades to "no metadata"
// (returns null) instead of crashing the service at import time.
//
export namespace MediaAnalyzer
{
    ///////////////////////////////////////////////////////////////////////////////////////
    /** Auto-suggest tags for an IMAGE via a vision model (through @repo/ai). Best-effort — returns `[]` when
     *  no AI key is configured or the call fails. `client` is the CHAT-modality client the caller resolved
     *  from the service's `config/ai` routing (keys come from the platform Secrets, wired at boot, media-17);
     *  when omitted it falls back to the platform default provider. */
    export async function suggestTags( bytes : Uint8Array, mime : string, maxTags : number = 12, client? : Ai ) : Promise<Array<string>>
    {
        try
        {
            const ai : Ai = client ?? AiFactory.create( { provider: Ai.Provider.OPENAI } );
            const schema : Type.JsonObject = { type: "object", additionalProperties: false, required: [ "tags" ],
                properties: { tags: { type: "array", items: { type: "string" }, maxItems: maxTags } } };
            const result : Ai.Result<{ tags : Array<string> }> = await ai.structured<{ tags : Array<string> }>( {
                messages: [
                    { role: Ai.Role.SYSTEM, content: "You tag media assets for a library. Return concise, lowercase tags (one or two words) describing the image's subjects, setting, mood, colors, and style. No duplicates, no sentences." },
                    { role: Ai.Role.USER, content: `Suggest up to ${ maxTags } search tags for this image.`, images: [ { b64: Buffer.from( bytes ).toString( "base64" ), mime } ] },
                ],
                schema,
            } );
            if( !result.ok ) return [];
            const tags : Array<string> = ( result.value.tags ?? [] ).map( ( t ) => t.trim().toLowerCase() ).filter( Boolean );
            return Array.from( new Set( tags ) ).slice( 0, maxTags );
        }
        catch( error ) { console.error( "MediaAnalyzer.suggestTags failed", error ); return []; }
    }

    ///////////////////////////////////////////////////////////////////////////////////////
    /** Load sharp, tolerating CJS/ESM interop under tsx/esbuild (default may be the fn or the namespace). */
    async function loadSharp() : Promise<typeof import( "sharp" )>
    {
        const mod = await import( "sharp" );
        return ( ( mod as { default? : unknown } ).default ?? mod ) as typeof import( "sharp" );
    }

    ///////////////////////////////////////////////////////////////////////////////////////
    /** Probe an image buffer with sharp → ImageMeta, or null if sharp is unavailable / the bytes don't parse. */
    export async function analyzeImage( bytes : Uint8Array ) : Promise<Media.ImageMeta | null>
    {
        try
        {
            const sharp = await loadSharp();
            const meta = await sharp( Buffer.from( bytes ), { failOn: "none" } ).metadata();
            return {
                width:       meta.width ?? 0,
                height:      meta.height ?? 0,
                format:      meta.format,
                space:       meta.space,
                channels:    meta.channels,
                depth:       meta.depth,
                density:     meta.density,
                hasAlpha:    meta.hasAlpha,
                orientation: meta.orientation,
                pages:       meta.pages,
            };
        }
        catch( error ) { console.error( "MediaAnalyzer.analyzeImage failed", error ); return null; }
    }

    ///////////////////////////////////////////////////////////////////////////////////////
    /** A resized image rendition produced by {@link resizeImage}. */
    export interface Rendition { bytes : Uint8Array; width : number; height : number; size : number; format : string; }

    ///////////////////////////////////////////////////////////////////////////////////////
    /** Resize an image buffer to a spec (sharp) → the rendition bytes + produced geometry/size, or null on
     *  failure. `fit` maps to sharp's fit; `format` transcodes when set (else keeps the source format). */
    export async function resizeImage( bytes : Uint8Array, spec : Media.VariantSpec ) : Promise<Rendition | null>
    {
        try
        {
            const sharp = await loadSharp();
            let pipeline = sharp( Buffer.from( bytes ), { failOn: "none" } ).rotate();   // honor EXIF orientation
            pipeline = pipeline.resize( {
                width:  spec.width,
                height: spec.height,
                fit:    spec.fit === "contain" ? "contain" : spec.fit === "fit" ? "fill" : "cover",
                withoutEnlargement: true,
            } );
            if( spec.format ) pipeline = pipeline.toFormat( spec.format as keyof import( "sharp" ).FormatEnum, spec.quality ? { quality: spec.quality } : undefined );

            const out = await pipeline.toBuffer( { resolveWithObject: true } );
            return { bytes: out.data, width: out.info.width, height: out.info.height, size: out.info.size, format: out.info.format };
        }
        catch( error ) { console.error( "MediaAnalyzer.resizeImage failed", error ); return null; }
    }

    ///////////////////////////////////////////////////////////////////////////////////////
    /** Rasterize an SVG to a single square PNG thumbnail — NOT {@link resizeImage} (which is for raster
     *  photos and deliberately never enlarges). Sharp/libvips decodes a vector source at a flat 72 DPI by
     *  default regardless of target size, so an icon with a small intrinsic size (e.g. a 12×12 viewBox)
     *  decodes to a tiny raster BEFORE any resize step runs — `withoutEnlargement` then locks every
     *  "variant" to that tiny size (this was the cause of an SVG's derived thumbnail coming out ~12×12).
     *  This probes the SVG's own intrinsic size first, computes a `density` that decodes it large enough
     *  to fill `targetSize` crisply, and explicitly ALLOWS enlargement (upscaling a vector is lossless). */
    export async function rasterizeSvgToThumbnail( bytes : Uint8Array, targetSize : number ) : Promise<Rendition | null>
    {
        try
        {
            const sharp = await loadSharp();
            const nativeMeta = await sharp( Buffer.from( bytes ), { failOn: "none" } ).metadata();
            const nativeSize : number = Math.max( nativeMeta.width ?? 0, nativeMeta.height ?? 0, 1 );
            // scale sharp's default 72 DPI decode up so the intrinsic size already meets targetSize; clamp
            // to a sane ceiling so a pathologically tiny viewBox (e.g. 1×1) can't demand an absurd density
            const density : number = Math.min( 2400, Math.max( 72, Math.round( 72 * ( targetSize / nativeSize ) ) ) );

            const out = await sharp( Buffer.from( bytes ), { density, failOn: "none" } )
                .resize( { width: targetSize, height: targetSize, fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 }, withoutEnlargement: false } )
                .png()
                .toBuffer( { resolveWithObject: true } );
            return { bytes: out.data, width: out.info.width, height: out.info.height, size: out.info.size, format: out.info.format };
        }
        catch( error ) { console.error( "MediaAnalyzer.rasterizeSvgToThumbnail failed", error ); return null; }
    }

    ///////////////////////////////////////////////////////////////////////////////////////
    /** Crop an image to a normalized rectangle (fractions of W/H) then resize to the spec — sharp `extract` +
     *  `resize` (cover). Used for the square avatar renditions framed by the pan/zoom crop. The source is
     *  EXIF-rotated FIRST so the crop rect maps to what the user actually saw. Returns null on failure. */
    export async function cropResizeImage( bytes : Uint8Array, crop : Media.CropRect, spec : Media.VariantSpec ) : Promise<Rendition | null>
    {
        try
        {
            const sharp = await loadSharp();
            // bake EXIF rotation, then probe the ROTATED dimensions the crop fractions are relative to
            const rotated : Buffer = await sharp( Buffer.from( bytes ), { failOn: "none" } ).rotate().toBuffer();
            const meta = await sharp( rotated ).metadata();
            const width : number = meta.width ?? 0;
            const height : number = meta.height ?? 0;
            if( width === 0 || height === 0 ) return null;
            // clamp the normalized rect to the image bounds → an integer pixel extract region
            const left : number = Math.max( 0, Math.min( width - 1, Math.round( crop.x * width ) ) );
            const top : number = Math.max( 0, Math.min( height - 1, Math.round( crop.y * height ) ) );
            const cropWidth : number = Math.max( 1, Math.min( width - left, Math.round( crop.w * width ) ) );
            const cropHeight : number = Math.max( 1, Math.min( height - top, Math.round( crop.h * height ) ) );

            let pipeline = sharp( rotated ).extract( { left, top, width: cropWidth, height: cropHeight } );
            pipeline = pipeline.resize( { width: spec.width, height: spec.height, fit: "cover" } );
            if( spec.format ) pipeline = pipeline.toFormat( spec.format as keyof import( "sharp" ).FormatEnum, spec.quality ? { quality: spec.quality } : undefined );
            const out = await pipeline.toBuffer( { resolveWithObject: true } );
            return { bytes: out.data, width: out.info.width, height: out.info.height, size: out.info.size, format: out.info.format };
        }
        catch( error ) { console.error( "MediaAnalyzer.cropResizeImage failed", error ); return null; }
    }

    ///////////////////////////////////////////////////////////////////////////////////////
    /** Re-render an image at a target DPI/density (media-4). Always stamps the `density` metadata; when
     *  `upscale` and the source density is BELOW the target, resamples pixels UP by the ratio (lanczos3) so the
     *  physical print size is preserved at the higher DPI (never downscales for density). Returns null on
     *  failure. (True upscaling interpolates — it hits the DPI requirement but adds no real detail.) */
    export async function setDensity( bytes : Uint8Array, dpi : number, upscale : boolean ) : Promise<Rendition | null>
    {
        try
        {
            const sharp = await loadSharp();
            const source = sharp( Buffer.from( bytes ), { failOn: "none" } ).rotate();   // honor EXIF orientation
            const meta = await source.metadata();
            const sourceDensity : number = meta.density && meta.density > 0 ? meta.density : 72;
            let pipeline = source;
            if( upscale && sourceDensity < dpi && meta.width )
            {
                const ratio : number = dpi / sourceDensity;
                pipeline = pipeline.resize( { width: Math.round( meta.width * ratio ), withoutEnlargement: false, kernel: "lanczos3" } );
            }
            pipeline = pipeline.withMetadata( { density: dpi } );

            const out = await pipeline.toBuffer( { resolveWithObject: true } );
            return { bytes: out.data, width: out.info.width, height: out.info.height, size: out.info.size, format: out.info.format };
        }
        catch( error ) { console.error( "MediaAnalyzer.setDensity failed", error ); return null; }
    }

    ///////////////////////////////////////////////////////////////////////////////////////
    /** Extract a VIDEO frame at `atSeconds` (default ~1s) as a JPEG poster rendition (ffmpeg + the static
     *  binary), ≤640px wide, or null on failure. Spools the video to a temp file, screenshots one frame, reads
     *  it back. Returned as a {@link Rendition} so it's stored + indexed exactly like an image variant. */
    export async function extractVideoPoster( bytes : Uint8Array, ext : string, atSeconds : number = 1 ) : Promise<Rendition | null>
    {
        const id : string = randomUUID();
        const videoPath : string = path.join( os.tmpdir(), `media-poster-src-${ id }.${ ext || "mp4" }` );
        const outName : string = `media-poster-${ id }.jpg`;
        const outPath : string = path.join( os.tmpdir(), outName );
        try
        {
            const ffmpegModule = await import( "fluent-ffmpeg" );
            const ffmpegStatic = await import( "ffmpeg-static" );
            const ffprobeStatic = await import( "ffprobe-static" );
            const ffmpeg = ( ( ffmpegModule as { default? : unknown } ).default ?? ffmpegModule ) as typeof import( "fluent-ffmpeg" );
            const ffmpegBin : string | null = ( ffmpegStatic as { default? : string | null } ).default ?? ( ffmpegStatic as unknown as string );
            if( ffmpegBin ) ffmpeg.setFfmpegPath( ffmpegBin );
            const probePath : string = ( ffprobeStatic as { path? : string; default? : { path? : string } } ).path ?? ( ffprobeStatic as { default? : { path? : string } } ).default?.path ?? "ffprobe";
            ffmpeg.setFfprobePath( probePath );

            await fs.writeFile( videoPath, bytes );
            await new Promise<void>( ( resolve, reject ) =>
            {
                ffmpeg( videoPath )
                    .on( "end", () => resolve() )
                    .on( "error", ( err : Error ) => reject( err ) )
                    .screenshots( { timestamps: [ String( Math.max( 0, atSeconds ) ) ], filename: outName, folder: os.tmpdir(), size: "640x?" } );
            } );

            const posterBytes : Buffer = await fs.readFile( outPath );
            const sharp = await loadSharp();
            const meta = await sharp( posterBytes ).metadata();
            return { bytes: posterBytes, width: meta.width ?? 0, height: meta.height ?? 0, size: posterBytes.length, format: "jpeg" };
        }
        catch( error ) { console.error( "MediaAnalyzer.extractVideoPoster failed", error ); return null; }
        finally
        {
            await fs.unlink( videoPath ).catch( () => { /* best-effort */ } );
            await fs.unlink( outPath ).catch( () => { /* best-effort */ } );
        }
    }

    ///////////////////////////////////////////////////////////////////////////////////////
    /** A burned-in text overlay for a render segment, positioned relatively (normalized 0..1) so it lands the
     *  same place in EVERY output format. */
    export interface RenderOverlay { text : string; xPct : number; yPct : number; fontPct : number; align : "left" | "center" | "right"; }

    /** One resolved segment for {@link renderVideo}: source bytes (image/video) or a text card, + overlays. */
    export interface RenderSegment
    {
        kind        : "image" | "video" | "text";
        bytes?      : Uint8Array;   // source bytes for image/video segments (written to a temp file internally)
        ext?        : string;       // source file extension (e.g. "png", "mp4")
        text?       : string;       // text-card body
        overlays?   : Array<RenderOverlay>;
        durationSec : number;
    }

    /** Escape a string for use inside an ffmpeg drawtext `text='…'` value. */
    function drawtextEscape( value : string ) : string
    {
        return value.replace( /\\/g, "\\\\" ).replace( /'/g, "’" ).replace( /:/g, "\\:" ).replace( /%/g, "\\%" );
    }

    /** Convert a `#rrggbb` hex to the ffmpeg `0xrrggbb` color form (drawtext expects `0x…` or a named color);
     *  a value that isn't a 6-digit hex (e.g. already `0x…` or a name like `white`) is passed through. */
    function ffColor( hex : string ) : string
    {
        return /^#[0-9a-fA-F]{6}$/.test( hex ) ? `0x${ hex.slice( 1 ) }` : hex;
    }

    /** Clamp an opacity to [0,1] with two decimals, for the drawtext `color@alpha` suffix. */
    function ffAlpha( opacity : number ) : string
    {
        return Math.max( 0, Math.min( 1, opacity ) ).toFixed( 2 );
    }

    /** Decompose a playback-speed factor into a chain of `atempo` filters (each pitch-preserving but limited to
     *  [0.5, 2.0]) whose product equals `speed` — so slow-mo (e.g. 0.25 → 0.5,0.5) and fast (4 → 2,2) work. */
    function atempoChain( speed : number ) : Array<string>
    {
        const parts : Array<string> = [];
        let remaining : number = speed;
        while( remaining > 2.0 ) { parts.push( "atempo=2.0" ); remaining /= 2.0; }
        while( remaining < 0.5 ) { parts.push( "atempo=0.5" ); remaining /= 0.5; }
        parts.push( `atempo=${ remaining.toFixed( 4 ) }` );
        return parts;
    }

    /** Map a {@link StudioProject.BlendMode} to ffmpeg's `blend` filter mode name — every non-NORMAL value
     *  happens to share ffmpeg's own mode name (CSS `mix-blend-mode` and ffmpeg's blend modes line up 1:1 for
     *  this set), so this is an identity lookup that also documents the mapping explicitly. */
    function ffBlendMode( mode : StudioProject.BlendMode ) : string
    {
        return mode;
    }

    /** Build the ffmpeg color-EFFECTS chain for a visual layer (`,eq=…`, `,gblur=…`, `,vignette`) from a clip's
     *  filters — neutral values are omitted; grayscale folds into `eq` saturation=0. Returns "" (no filters) or a
     *  leading-comma chain to splice into the layer prep. Mirrors the preview's CSS `filter`. */
    function videoFilterChain( filters : StudioProject.ClipFilters | undefined ) : string
    {
        if( filters === undefined ) return "";
        const parts : Array<string> = [];
        // brightness / contrast / saturation → a single eq node (grayscale = saturation 0)
        const equalize : Array<string> = [];
        const brightness : number = filters.brightness ?? 0;
        const contrast : number = filters.contrast ?? 1;
        const saturation : number = filters.grayscale ? 0 : ( filters.saturation ?? 1 );
        if( brightness !== 0 ) equalize.push( `brightness=${ brightness }` );
        if( contrast !== 1 ) equalize.push( `contrast=${ contrast }` );
        if( saturation !== 1 ) equalize.push( `saturation=${ saturation }` );
        if( equalize.length > 0 ) parts.push( `eq=${ equalize.join( ":" ) }` );
        // blur (fraction → gaussian sigma) + edge vignette
        const blur : number = filters.blur ?? 0;
        if( blur > 0 ) parts.push( `gblur=sigma=${ ( blur * StudioProject.FILTER_BLUR_MAX ).toFixed( 2 ) }` );
        if( filters.vignette ) parts.push( "vignette" );
        return parts.length > 0 ? "," + parts.join( "," ) : "";
    }

    /** The bundled font files (media-21.19) — one regular + one bold TTF per {@link StudioProject.TextFont}
     *  (DejaVu Sans/Serif/Mono, SIL/Bitstream-Vera licensed, see `assets/fonts/LICENSE`), so `fontFamily`/`bold`
     *  actually render in the ffmpeg export instead of falling back to ffmpeg's single default font. */
    const FONT_FILE_NAMES : Record<StudioProject.TextFont, { regular : string; bold : string }> =
    {
        [ StudioProject.TextFont.SANS ]:  { regular: "sans.ttf",  bold: "sans-bold.ttf" },
        [ StudioProject.TextFont.SERIF ]: { regular: "serif.ttf", bold: "serif-bold.ttf" },
        [ StudioProject.TextFont.MONO ]:  { regular: "mono.ttf",  bold: "mono-bold.ttf" },
    };

    /** The `assets/fonts` directory relative to THIS module — tried at both the dev (`src/pipeline/` → up two)
     *  and bundled (`bin/` → up one) layouts, the same self-locating approach `ffmpeg-static`/`ffprobe-static`
     *  use for their own binaries. Resolved once and cached (the layout can't change at runtime). */
    let fontsDir : string | null | undefined = undefined;
    function resolveFontsDir() : string | null
    {
        if( fontsDir !== undefined ) return fontsDir;
        const candidates : Array<string> = [
            path.join( __dirname, "..", "..", "assets", "fonts" ),   // dev: src/pipeline/ -> apps/core/media/assets/fonts
            path.join( __dirname, "..", "assets", "fonts" ),          // bundled: bin/ -> apps/core/media/assets/fonts
        ];
        fontsDir = candidates.find( ( candidate : string ) : boolean => existsSync( candidate ) ) ?? null;
        return fontsDir;
    }

    /** Resolve the absolute TTF path for a {@link StudioProject.TextFont} + weight, or null if the bundled
     *  fonts directory can't be found (drawtext then falls back to ffmpeg's default font). */
    function fontFilePath( font : StudioProject.TextFont, bold : boolean ) : string | null
    {
        const dir : string | null = resolveFontsDir();
        if( dir === null ) return null;
        const names : { regular : string; bold : string } = FONT_FILE_NAMES[ font ];
        return path.join( dir, bold ? names.bold : names.regular );
    }

    /** Escape a filesystem path for use inside an ffmpeg filter value (drawtext `fontfile=…`), where `:` and
     *  `\` are filtergraph metacharacters and the whole value is single-quoted. */
    function drawtextPathEscape( value : string ) : string
    {
        return value.replace( /\\/g, "\\\\" ).replace( /'/g, "’" ).replace( /:/g, "\\:" );
    }

    /** Build the drawtext STYLE options (font file / fill / outline / shadow / background box) from a text
     *  layer's style, filling unset fields from {@link StudioProject.DEFAULT_TEXT_STYLE} so an unstyled layer
     *  draws the legacy white-with-shadow look. Widths/padding scale with the font size to match the preview
     *  across formats. */
    function drawtextStyleOptions( style : StudioProject.TextStyle | undefined, fontSize : number ) : Array<string>
    {
        const resolved : StudioProject.TextStyle = { ...StudioProject.DEFAULT_TEXT_STYLE, ...( style ?? {} ) };
        const options : Array<string> = [ `fontcolor=${ ffColor( resolved.color ?? "#ffffff" ) }` ];
        // font family/weight → a bundled TTF (falls back to ffmpeg's default font if the assets dir is missing)
        const fontPath : string | null = fontFilePath( resolved.fontFamily ?? StudioProject.TextFont.SANS, resolved.bold === true );
        if( fontPath !== null ) options.push( `fontfile='${ drawtextPathEscape( fontPath ) }'` );
        // outline → border; width relative to the font size
        if( resolved.outline !== undefined && resolved.outline.widthPct > 0 )
        {
            options.push( `borderw=${ Math.max( 1, Math.round( resolved.outline.widthPct * fontSize ) ) }` );
            options.push( `bordercolor=${ ffColor( resolved.outline.color ) }` );
        }
        // drop shadow (on unless explicitly disabled) — matches the preview's textShadow
        if( resolved.shadow !== false )
            options.push( "shadowcolor=black@0.6", "shadowx=2", "shadowy=2" );
        // background box (lower-third) → box + boxcolor@opacity + padding
        if( resolved.background !== undefined )
        {
            options.push( "box=1" );
            options.push( `boxcolor=${ ffColor( resolved.background.color ) }@${ ffAlpha( resolved.background.opacity ) }` );
            options.push( `boxborderw=${ Math.max( 1, Math.round( resolved.background.padPct * fontSize ) ) }` );
        }
        return options;
    }

    /** Build the drawtext x/y/fontsize EXPRESSIONS for a TEXT layer's entry animation, animating for real via
     *  ffmpeg time-expressions (evaluated per-frame, same eval engine already driving the alpha fade ramps).
     *  SLIDE_* animates position from off-screen to the target; POP animates `fontsize` up from small (drawtext
     *  re-measures `text_w`/`text_h` each frame, so the target x/y — which reference them — stay centered as it
     *  scales). FADE and TYPEWRITER have no drawtext geometry equivalent (typewriter needs per-character reveal,
     *  which would need per-frame text generation — out of reach for a single drawtext node), so both fall back
     *  to the static target position; their "animation" is the caller's plain alpha fade-in. */
    function textAnimationGeometry( animateIn : StudioProject.TextAnimateIn | undefined, start : number, width : number, height : number, fontSize : number, targetXExpr : string, targetYExpr : string ) : { xExpr : string; yExpr : string; fontSizeExpr : string }
    {
        const identity : { xExpr : string; yExpr : string; fontSizeExpr : string } = { xExpr: targetXExpr, yExpr: targetYExpr, fontSizeExpr: String( fontSize ) };
        if( animateIn === undefined ) return identity;
        const dur : number = Math.max( 0.05, animateIn.durationSec );
        const progress : string = `min(1,(t-${ start })/${ dur })`;
        const active : string = `lt(t-${ start },${ dur })`;
        switch( animateIn.type )
        {
            case StudioProject.TextAnimation.SLIDE_LEFT:      // settles at target, enters from off-screen RIGHT
                return { ...identity, xExpr: `if(${ active },(${ targetXExpr })+(${ width }-(${ targetXExpr }))*(1-${ progress }),${ targetXExpr })` };
            case StudioProject.TextAnimation.SLIDE_RIGHT:     // enters from off-screen LEFT
                return { ...identity, xExpr: `if(${ active },(${ targetXExpr })+(-text_w-(${ targetXExpr }))*(1-${ progress }),${ targetXExpr })` };
            case StudioProject.TextAnimation.SLIDE_UP:        // enters from BELOW the frame
                return { ...identity, yExpr: `if(${ active },(${ targetYExpr })+(${ height }-(${ targetYExpr }))*(1-${ progress }),${ targetYExpr })` };
            case StudioProject.TextAnimation.SLIDE_DOWN:      // enters from ABOVE the frame
                return { ...identity, yExpr: `if(${ active },(${ targetYExpr })+(-text_h-(${ targetYExpr }))*(1-${ progress }),${ targetYExpr })` };
            case StudioProject.TextAnimation.POP:             // scales up from 40% size (caller adds the fade)
                return { ...identity, fontSizeExpr: `if(${ active },max(1,round(${ fontSize }*(0.4+0.6*${ progress }))),${ fontSize })` };
            default:
                return identity;   // FADE / TYPEWRITER — geometry stays static; caller's alpha fade carries it
        }
    }

    /** Build a drawtext filter for one relative overlay against a WxH frame (x/y expressions in ffmpeg vars). */
    function overlayFilter( overlay : RenderOverlay, height : number ) : string
    {
        const fontSize : number = Math.max( 8, Math.round( overlay.fontPct * height ) );
        const xExpr : string = overlay.align === "left" ? `(w*${ overlay.xPct })`
            : overlay.align === "right" ? `(w*${ overlay.xPct })-text_w`
            : `(w*${ overlay.xPct })-(text_w/2)`;
        const yExpr : string = `(h*${ overlay.yPct })-(text_h/2)`;
        return `drawtext=text='${ drawtextEscape( overlay.text ) }':fontcolor=white:fontsize=${ fontSize }:x=${ xExpr }:y=${ yExpr }:shadowcolor=black@0.6:shadowx=2:shadowy=2`;
    }

    /** Composite a video project's timeline into an mp4 (Studio video render / a destination variant). Each
     *  scene is normalized to a uniform H.264 clip at WxH @ fps (media COVER-fit + cropped so it fills the
     *  aspect; text cards on a dark bg) with its relative overlays BURNED IN, then the clips are concatenated.
     *  The relative overlay geometry means the SAME doc renders correctly at any target size. Returns the mp4
     *  bytes, or null if nothing rendered; a scene that fails to normalize is skipped (best-effort). */
    export async function renderVideo( segments : Array<RenderSegment>, width : number, height : number, fps : number ) : Promise<Uint8Array | null>
    {
        if( segments.length === 0 ) return null;
        const runId : string = randomUUID();
        const workDir : string = path.join( os.tmpdir(), `studio-render-${ runId }` );
        const outPath : string = path.join( workDir, "out.mp4" );
        const listPath : string = path.join( workDir, "list.txt" );
        // COVER: scale up to fill the frame, then crop the overflow (fills the target aspect, no letterbox)
        const coverFit : string = `scale=${ width }:${ height }:force_original_aspect_ratio=increase,crop=${ width }:${ height },setsar=1,fps=${ fps }`;

        try
        {
            // configure fluent-ffmpeg against the bundled static binary (lazy import — degrade if unbuilt)
            const ffmpegModule = await import( "fluent-ffmpeg" );
            const ffmpegStatic = await import( "ffmpeg-static" );
            const ffmpeg = ( ( ffmpegModule as { default? : unknown } ).default ?? ffmpegModule ) as typeof import( "fluent-ffmpeg" );
            const ffmpegBin : string | null = ( ffmpegStatic as { default? : string | null } ).default ?? ( ffmpegStatic as unknown as string );
            if( ffmpegBin ) ffmpeg.setFfmpegPath( ffmpegBin );
            await fs.mkdir( workDir, { recursive: true } );

            // normalize each scene to a uniform clip; collect the ones that succeed
            const segmentPaths : Array<string> = [];
            for( let index : number = 0; index < segments.length; index++ )
            {
                const segment : RenderSegment = segments[ index ];
                const segPath : string = path.join( workDir, `seg-${ index }.mp4` );
                const duration : number = Math.max( 0.1, segment.durationSec );
                try
                {
                    // spool an image/video source's bytes to a temp file (text cards need no source)
                    const isMedia : boolean = ( segment.kind === "image" || segment.kind === "video" ) && segment.bytes !== undefined;
                    const srcPath : string = path.join( workDir, `src-${ index }.${ segment.ext || "bin" }` );
                    if( isMedia && segment.bytes ) await fs.writeFile( srcPath, segment.bytes );

                    // build the filter chain: base fit / card, then each overlay burned on top
                    const filters : Array<string> = [];
                    if( isMedia ) filters.push( coverFit );
                    if( !isMedia && segment.text ) filters.push( overlayFilter( { text: segment.text, xPct: 0.5, yPct: 0.5, fontPct: 0.08, align: "center" }, height ) );
                    for( const overlay of segment.overlays ?? [] ) filters.push( overlayFilter( overlay, height ) );

                    await new Promise<void>( ( resolve : () => void, reject : ( error : Error ) => void ) : void =>
                    {
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        let command : any;
                        if( !isMedia )
                            command = ffmpeg( `color=c=0x111111:s=${ width }x${ height }:r=${ fps }` ).inputFormat( "lavfi" );
                        else if( segment.kind === "image" )
                            command = ffmpeg( srcPath ).inputOptions( [ "-loop 1" ] );
                        else
                            command = ffmpeg( srcPath );
                        if( filters.length > 0 ) command = command.videoFilters( filters );
                        command.outputOptions( [ `-t ${ duration }`, "-c:v libx264", "-pix_fmt yuv420p", "-an", "-preset veryfast" ] )
                            .on( "end", () : void => resolve() )
                            .on( "error", ( error : Error ) : void => reject( error ) )
                            .save( segPath );
                    } );
                    segmentPaths.push( segPath );
                }
                catch( error ) { console.error( `MediaAnalyzer.renderVideo: scene ${ index } failed`, error ); }
            }
            if( segmentPaths.length === 0 ) return null;

            // concat the normalized clips (uniform params → stream copy)
            const listBody : string = segmentPaths.map( ( segPath : string ) : string => `file '${ segPath }'` ).join( "\n" );
            await fs.writeFile( listPath, listBody );
            await new Promise<void>( ( resolve : () => void, reject : ( error : Error ) => void ) : void =>
            {
                ffmpeg( listPath ).inputOptions( [ "-f concat", "-safe 0" ] ).outputOptions( [ "-c copy" ] )
                    .on( "end", () : void => resolve() )
                    .on( "error", ( error : Error ) : void => reject( error ) )
                    .save( outPath );
            } );

            const bytes : Buffer = await fs.readFile( outPath );
            return bytes;
        }
        catch( error ) { console.error( "MediaAnalyzer.renderVideo failed", error ); return null; }
        finally { await fs.rm( workDir, { recursive: true, force: true } ).catch( () => { /* best-effort */ } ); }
    }

    ///////////////////////////////////////////////////////////////////////////////////////
    /** One layer for {@link renderComposite}: a still image, a video clip, or an audio clip, placed at an
     *  absolute start. Video/audio layers contribute to the mixed soundtrack unless muted; `hasAudio` marks a
     *  video whose source actually has an audio stream (so the graph never references a missing `[i:a]`). */
    export interface CompositeMediaLayer
    {
        kind          : "image" | "video" | "audio" | "solid";
        bytes         : Uint8Array;
        ext?          : string;
        color?        : string;    // solid: fill color (hex, e.g. #1a2b3c)
        startSec      : number;
        durationSec   : number;
        trimStartSec? : number;   // in-point into the source (video/audio only)
        hasAudio?     : boolean;   // video: the source has an audio stream (audio clips are always true)
        muted?        : boolean;   // exclude this layer's audio from the mix
        volume?       : number;    // 0..1 gain
        loop?         : boolean;   // audio: loop the source to fill the clip's timeline duration
        speed?        : number;    // playback rate (1 = normal); source consumed = durationSec × speed
        reverse?      : boolean;   // play the source backwards (video `reverse` / audio `areverse`)
        fadeInSec?    : number;    // transition: alpha (+ audio) ramp IN over N seconds
        fadeOutSec?   : number;    // transition: alpha (+ audio) ramp OUT over N seconds
        transform?    : StudioProject.ClipTransform;   // per-clip fit / scale / rotation / opacity / position
        kenBurns?     : StudioProject.KenBurns;         // animated pan-zoom (exported as a static midpoint zoom)
        filters?      : StudioProject.ClipFilters;      // color effects: brightness / contrast / saturation / grayscale / blur / vignette
        blend?        : StudioProject.BlendMode;        // how this layer composites over the ones beneath (real for the default/untransformed layout — see {@link ffBlendMode})
    }

    /** One burned-in text layer for {@link renderComposite}: relative geometry + an absolute time window. */
    export interface CompositeTextLayer
    {
        text        : string;
        startSec    : number;
        durationSec : number;
        xPct        : number;
        yPct        : number;
        fontPct     : number;
        align       : "left" | "center" | "right";
        fadeInSec?  : number;
        fadeOutSec? : number;
        style?      : StudioProject.TextStyle;   // fill / outline / shadow / background (drawtext options)
        animateIn?  : StudioProject.TextAnimateIn;   // entry animation (slide/pop animate for real; see {@link textAnimationGeometry})
    }

    /** A logo/watermark burned over the WHOLE composite (top-most): the image bytes + its corner placement,
     *  width (fraction of frame width), opacity, and edge margin (fraction of frame width). */
    export interface CompositeWatermark
    {
        bytes     : Uint8Array;
        ext?      : string;
        corner    : StudioProject.WatermarkCorner;
        scalePct  : number;
        opacity   : number;
        marginPct : number;
    }

    /** Composite a MULTI-TRACK timeline into an mp4 via a single ffmpeg filter_complex graph — the TRUE-OVERLAP
     *  render (unlike {@link renderVideo}'s sequential concat). `media` layers are given in PAINT order
     *  (bottom-most first): each is cover-fit to WxH, shifted to its absolute start (`setpts`) and composited
     *  with an `overlay` whose `enable` time window makes it visible only during its span — so clips that
     *  overlap in time on DIFFERENT tracks stack correctly. `texts` are burned on top via `drawtext` (also
     *  time-windowed, relative geometry that reflows across formats). Silent for now (audio mix is a follow-up).
     *  Returns the mp4 bytes, or null on failure. NOTE: ffmpeg is UNVERIFIED in this environment. */
    export async function renderComposite( width : number, height : number, fps : number, durationSec : number, media : Array<CompositeMediaLayer>, texts : Array<CompositeTextLayer>, watermark? : CompositeWatermark, encode? : { crf : number; preset : string; bitrateKbps? : number } ) : Promise<Uint8Array | null>
    {
        const runId : string = randomUUID();
        const workDir : string = path.join( os.tmpdir(), `studio-composite-${ runId }` );
        const outPath : string = path.join( workDir, "out.mp4" );
        const total : number = Math.max( 0.1, durationSec );

        try
        {
            // configure fluent-ffmpeg against the bundled static binary (lazy import — degrade if unbuilt)
            const ffmpegModule = await import( "fluent-ffmpeg" );
            const ffmpegStatic = await import( "ffmpeg-static" );
            const ffmpeg = ( ( ffmpegModule as { default? : unknown } ).default ?? ffmpegModule ) as typeof import( "fluent-ffmpeg" );
            const ffmpegBin : string | null = ( ffmpegStatic as { default? : string | null } ).default ?? ( ffmpegStatic as unknown as string );
            if( ffmpegBin ) ffmpeg.setFfmpegPath( ffmpegBin );
            await fs.mkdir( workDir, { recursive: true } );

            // input 0 = a full-duration black canvas; inputs 1..N = each media layer's spooled source file
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            let command : any = ffmpeg( `color=c=black:s=${ width }x${ height }:r=${ fps }:d=${ total }` ).inputFormat( "lavfi" );
            for( let index : number = 0; index < media.length; index++ )
            {
                const layer : CompositeMediaLayer = media[ index ];
                // a SOLID layer has no bytes — it's a generated lavfi color source at full frame size
                if( layer.kind === "solid" )
                {
                    command = command.input( `color=c=${ ffColor( layer.color ?? "#000000" ) }:s=${ width }x${ height }:r=${ fps }:d=${ Math.max( 0.1, layer.durationSec ) }` ).inputFormat( "lavfi" );
                    continue;
                }
                const srcPath : string = path.join( workDir, `src-${ index }.${ layer.ext || "bin" }` );
                await fs.writeFile( srcPath, layer.bytes );
                command = command.input( srcPath );
                if( layer.kind === "image" ) command = command.inputOptions( [ "-loop 1" ] );   // still image → loop across its window
                else if( layer.kind === "audio" && layer.loop === true ) command = command.inputOptions( [ "-stream_loop -1" ] );   // background music → loop the source (atrim cuts it to duration)
            }
            // the watermark image (if any) is the LAST input, looped so it persists across the whole timeline
            const watermarkInputIndex : number = media.length + 1;   // inputs: 0 = canvas, 1..N = media, N+1 = watermark
            if( watermark !== undefined )
            {
                const watermarkPath : string = path.join( workDir, `watermark.${ watermark.ext || "png" }` );
                await fs.writeFile( watermarkPath, watermark.bytes );
                command = command.input( watermarkPath ).inputOptions( [ "-loop 1" ] );
            }

            // build the video graph: prep each layer, overlay in paint order, then burn text on top
            const filters : Array<string> = [];
            let last : string = "0:v";
            for( let index : number = 0; index < media.length; index++ )
            {
                const layer : CompositeMediaLayer = media[ index ];
                if( layer.kind === "audio" ) continue;   // audio-only layer contributes no video (still an input slot)
                const inputIndex : number = index + 1;   // input 0 is the base canvas
                const start : number = Math.max( 0, layer.startSec );
                const end : number = start + Math.max( 0.1, layer.durationSec );
                // playback speed (video only): consume `duration × speed` of source, then `setpts /= speed`
                // compresses (fast, >1) or stretches (slow-mo, <1) it back to the clip's timeline duration
                const speed : number = layer.kind === "video" && layer.speed !== undefined && layer.speed > 0 ? layer.speed : 1;
                // cover-fit to the frame, select the source window, then shift onto the timeline at `start`
                const sourceTrim : string = layer.kind === "video"
                    ? `trim=start=${ layer.trimStartSec ?? 0 }:duration=${ layer.durationSec * speed }`
                    : `trim=duration=${ layer.durationSec }`;
                const setptsExpr : string = speed !== 1 ? `setpts=(PTS-STARTPTS)/${ speed }+${ start }/TB` : `setpts=PTS-STARTPTS+${ start }/TB`;
                const reverseFilter : string = layer.reverse === true ? ",reverse" : "";   // buffers the trimmed segment — fine for short clips
                // transitions: fade the alpha in/out so the fade composites over the layers beneath (not to black)
                const fadeIn : number = Math.max( 0, layer.fadeInSec ?? 0 );
                const fadeOut : number = Math.max( 0, layer.fadeOutSec ?? 0 );
                let fade : string = "";
                if( fadeIn > 0 || fadeOut > 0 )
                {
                    fade += ",format=yuva420p";
                    if( fadeIn > 0 ) fade += `,fade=t=in:st=${ start }:d=${ fadeIn }:alpha=1`;
                    if( fadeOut > 0 ) fade += `,fade=t=out:st=${ Math.max( start, start + layer.durationSec - fadeOut ) }:d=${ fadeOut }:alpha=1`;
                }
                // color EFFECTS chain (eq / gblur / vignette) — spliced into whichever layer path runs
                const colorChain : string = videoFilterChain( layer.filters );
                // a per-clip transform (or Ken Burns) takes a GENERALIZED path; otherwise the fast cover-fit path
                if( layer.transform === undefined && layer.kenBurns === undefined )
                {
                    // default: cover-fit + crop to the frame, apply effects, composited full-frame
                    filters.push( `[${ inputIndex }:v]scale=${ width }:${ height }:force_original_aspect_ratio=increase,crop=${ width }:${ height }${ colorChain },setsar=1,fps=${ fps },${ sourceTrim }${ reverseFilter },${ setptsExpr }${ fade }[v${ index }]` );
                    // a non-NORMAL blend mode composites via ffmpeg's `blend` (pixel-mode math) instead of plain
                    // `overlay` — safe here because this layer already exactly fills the frame at (0,0), so
                    // blend's "same-size, pixel-aligned" requirement holds (the transform/Ken Burns path below can
                    // place a layer off-center/at another size, where `blend` doesn't apply — those still composite
                    // as `normal`, per {@link StudioProject.BlendMode}'s doc comment)
                    if( layer.blend !== undefined && layer.blend !== StudioProject.BlendMode.NORMAL )
                    {
                        // `blend`'s math is per-COMPONENT — run in yuv420p (the pipeline's working format) it
                        // multiplies/screens luma+chroma planes directly, which doesn't correspond to RGB math
                        // (chroma is centered on 128, not 0) and produces garbage colors. Force both inputs to
                        // an RGB planar format first, blend there, then convert back for the rest of the chain.
                        filters.push( `[v${ index }]format=gbrp[vb${ index }]` );
                        filters.push( `[${ last }]format=gbrp[lb${ index }]` );
                        filters.push( `[vb${ index }][lb${ index }]blend=all_mode=${ ffBlendMode( layer.blend ) }:eof_action=pass:enable='between(t,${ start },${ end })',format=yuv420p[o${ index }]` );
                    }
                    else
                        filters.push( `[${ last }][v${ index }]overlay=eof_action=pass:enable='between(t,${ start },${ end })'[o${ index }]` );
                }
                else
                {
                    // fold a Ken Burns pan/zoom into a STATIC midpoint transform for the export (the animated
                    // pan/zoom is preview-only fidelity — the overlay graph places one static frame)
                    const kenBurns : StudioProject.KenBurns | undefined = layer.kenBurns;
                    const scale : number = ( layer.transform?.scale ?? 1 ) * ( kenBurns !== undefined ? ( kenBurns.fromScale + kenBurns.toScale ) / 2 : 1 );
                    const offsetXPct : number = ( layer.transform?.xPct ?? 0 ) + ( kenBurns !== undefined ? ( kenBurns.fromXPct + kenBurns.toXPct ) / 2 : 0 );
                    const offsetYPct : number = ( layer.transform?.yPct ?? 0 ) + ( kenBurns !== undefined ? ( kenBurns.fromYPct + kenBurns.toYPct ) / 2 : 0 );
                    const rotation : number = layer.transform?.rotation ?? 0;
                    const opacity : number = layer.transform?.opacity ?? 1;
                    const fitMode : string = layer.transform?.fit === StudioProject.FitMode.CONTAIN ? "decrease" : "increase";
                    // fit → optional zoom → optional rotate → alpha (needed for opacity + fade compositing)
                    let prep : string = `scale=${ width }:${ height }:force_original_aspect_ratio=${ fitMode }`;
                    if( scale !== 1 ) prep += `,scale=iw*${ scale }:ih*${ scale }`;
                    if( rotation !== 0 ) prep += `,rotate=${ rotation }*PI/180:c=none`;
                    prep += colorChain;
                    prep += ",format=yuva420p";
                    if( opacity !== 1 ) prep += `,colorchannelmixer=aa=${ ffAlpha( opacity ) }`;
                    // alpha fades (format is already yuva) applied after the time shift
                    let fadeAlpha : string = "";
                    if( fadeIn > 0 ) fadeAlpha += `,fade=t=in:st=${ start }:d=${ fadeIn }:alpha=1`;
                    if( fadeOut > 0 ) fadeAlpha += `,fade=t=out:st=${ Math.max( start, start + layer.durationSec - fadeOut ) }:d=${ fadeOut }:alpha=1`;
                    filters.push( `[${ inputIndex }:v]${ prep },setsar=1,fps=${ fps },${ sourceTrim }${ reverseFilter },${ setptsExpr }${ fadeAlpha }[v${ index }]` );
                    // composite CENTERED, then shift by the offset (fraction of the frame); the frame clips overflow
                    const xExpr : string = `(main_w-overlay_w)/2+(${ offsetXPct }*main_w)`;
                    const yExpr : string = `(main_h-overlay_h)/2+(${ offsetYPct }*main_h)`;
                    filters.push( `[${ last }][v${ index }]overlay=${ xExpr }:${ yExpr }:eof_action=pass:enable='between(t,${ start },${ end })'[o${ index }]` );
                }
                last = `o${ index }`;
            }

            // text layers → drawtext nodes chained on the composited stream (time-windowed, align-aware x)
            const drawnodes : Array<string> = texts.map( ( text : CompositeTextLayer ) : string =>
            {
                const fontSize : number = Math.max( 8, Math.round( text.fontPct * height ) );
                const targetXExpr : string = text.align === "left" ? `(w*${ text.xPct })`
                    : text.align === "right" ? `(w*${ text.xPct })-text_w`
                    : `(w*${ text.xPct })-(text_w/2)`;
                const targetYExpr : string = `(h*${ text.yPct })-(text_h/2)`;
                const start : number = Math.max( 0, text.startSec );
                const end : number = start + Math.max( 0.1, text.durationSec );
                // slide/pop entry animations drive REAL x/y/fontsize expressions; fade/typewriter keep the static
                // target position (their "animation" is the alpha ramp below)
                const geometry : { xExpr : string; yExpr : string; fontSizeExpr : string } = textAnimationGeometry( text.animateIn, start, width, height, fontSize, targetXExpr, targetYExpr );
                // transition: ramp text opacity via an alpha expression over the fade windows (single-quoted → commas safe)
                const fadeIn : number = Math.max( 0, text.fadeInSec ?? 0 );
                const fadeOut : number = Math.max( 0, text.fadeOutSec ?? 0 );
                const rampIn : string = fadeIn > 0 ? `min(1,(t-${ start })/${ fadeIn })` : "";
                const rampOut : string = fadeOut > 0 ? `min(1,(${ end }-t)/${ fadeOut })` : "";
                const ramp : string = rampIn && rampOut ? `min(${ rampIn },${ rampOut })` : rampIn || rampOut;
                const alpha : string = ramp !== "" ? `:alpha='${ ramp }'` : "";
                // style options (fill / outline / shadow / background) sit between the text and the geometry
                const styleOptions : string = drawtextStyleOptions( text.style, fontSize ).join( ":" );
                return `drawtext=text='${ drawtextEscape( text.text ) }':${ styleOptions }:fontsize='${ geometry.fontSizeExpr }':x='${ geometry.xExpr }':y='${ geometry.yExpr }':enable='between(t,${ start },${ end })'${ alpha }`;
            } );
            const textOut : string = watermark !== undefined ? "vtext" : "vout";
            if( drawnodes.length > 0 ) filters.push( `[${ last }]${ drawnodes.join( "," ) }[${ textOut }]` );
            else filters.push( `[${ last }]null[${ textOut }]` );

            // watermark → scale to its width (keep aspect, even dims), apply opacity, overlay in its corner for
            // the whole duration (top-most). Placement mirrors the preview's watermarkCss corner/margin math.
            if( watermark !== undefined )
            {
                const watermarkWidth : number = Math.max( 2, Math.round( width * watermark.scalePct ) );
                const margin : number = Math.round( width * watermark.marginPct );
                const isLeft : boolean = watermark.corner === StudioProject.WatermarkCorner.TOP_LEFT || watermark.corner === StudioProject.WatermarkCorner.BOTTOM_LEFT;
                const isTop : boolean = watermark.corner === StudioProject.WatermarkCorner.TOP_LEFT || watermark.corner === StudioProject.WatermarkCorner.TOP_RIGHT;
                const xExpr : string = isLeft ? `${ margin }` : `main_w-overlay_w-${ margin }`;
                const yExpr : string = isTop ? `${ margin }` : `main_h-overlay_h-${ margin }`;
                filters.push( `[${ watermarkInputIndex }:v]scale=${ watermarkWidth }:-2,format=rgba,colorchannelmixer=aa=${ ffAlpha( watermark.opacity ) }[wm]` );
                filters.push( `[vtext][wm]overlay=${ xExpr }:${ yExpr }[vout]` );
            }

            // audio graph: every unmuted video-with-audio + audio clip → trim/gain/delay-to-start, then amix
            const audioLabels : Array<string> = [];
            for( let index : number = 0; index < media.length; index++ )
            {
                const layer : CompositeMediaLayer = media[ index ];
                const contributes : boolean = layer.kind === "audio" || ( layer.kind === "video" && layer.hasAudio === true );
                if( !contributes || layer.muted === true ) continue;
                const inputIndex : number = index + 1;
                const start : number = Math.max( 0, layer.startSec );
                const delayMs : number = Math.round( start * 1000 );
                const gain : number = layer.volume ?? 1;
                const label : string = `a${ index }`;
                // audio transitions mirror the visual fades (local time — asetpts has reset the stream to 0)
                const fadeIn : number = Math.max( 0, layer.fadeInSec ?? 0 );
                const fadeOut : number = Math.max( 0, layer.fadeOutSec ?? 0 );
                let afade : string = "";
                if( fadeIn > 0 ) afade += `,afade=t=in:st=0:d=${ fadeIn }`;
                if( fadeOut > 0 ) afade += `,afade=t=out:st=${ Math.max( 0, layer.durationSec - fadeOut ) }:d=${ fadeOut }`;
                // speed: consume `duration × speed` of source, then atempo (pitch-preserving) brings it back to
                // the clip's timeline duration — the fades below run in that post-atempo output time
                const speed : number = layer.speed !== undefined && layer.speed > 0 ? layer.speed : 1;
                const atempo : string = speed !== 1 ? `${ atempoChain( speed ).join( "," ) },` : "";
                const areverse : string = layer.reverse === true ? "areverse," : "";
                filters.push( `[${ inputIndex }:a]atrim=start=${ layer.trimStartSec ?? 0 }:duration=${ layer.durationSec * speed },${ areverse }asetpts=PTS-STARTPTS,${ atempo }volume=${ gain }${ afade },adelay=${ delayMs }|${ delayMs }[${ label }]` );
                audioLabels.push( label );
            }
            const hasAudio : boolean = audioLabels.length > 0;
            if( hasAudio ) filters.push( `${ audioLabels.map( ( label : string ) : string => `[${ label }]` ).join( "" ) }amix=inputs=${ audioLabels.length }:normalize=0:duration=longest[aout]` );

            // encode the composited stream (with the mixed soundtrack when present, else silent). The quality
            // preset (crf + x264 preset) trades render time/size for visual quality; defaults to a balanced set.
            const outputs : Array<string> = hasAudio ? [ "vout", "aout" ] : [ "vout" ];
            const crf : number = encode?.crf ?? 23;
            const preset : string = encode?.preset ?? "medium";
            const bitrateKbps : number = encode?.bitrateKbps ?? 0;
            const options : Array<string> = [ `-t ${ total }`, "-c:v libx264", "-pix_fmt yuv420p", `-preset ${ preset }` ];
            // an explicit target bitrate (ABR: -b:v + cap) overrides the quality-based CRF encode
            if( bitrateKbps > 0 ) options.push( `-b:v ${ bitrateKbps }k`, `-maxrate ${ bitrateKbps }k`, `-bufsize ${ bitrateKbps * 2 }k` );
            else options.push( `-crf ${ crf }` );
            options.push( hasAudio ? "-c:a aac" : "-an" );
            await new Promise<void>( ( resolve : () => void, reject : ( error : Error ) => void ) : void =>
            {
                command.complexFilter( filters, outputs )
                    .outputOptions( options )
                    .on( "end", () : void => resolve() )
                    .on( "error", ( error : Error ) : void => reject( error ) )
                    .save( outPath );
            } );

            const bytes : Buffer = await fs.readFile( outPath );
            return bytes;
        }
        catch( error ) { console.error( "MediaAnalyzer.renderComposite failed", error ); return null; }
        finally { await fs.rm( workDir, { recursive: true, force: true } ).catch( () => { /* best-effort */ } ); }
    }

    ///////////////////////////////////////////////////////////////////////////////////////
    /** Render a video project via REMOTION / headless Chromium (media-21.18) — renders the SAME
     *  `StudioVideoComposition` React component that drives the browser preview, so preview == output exactly
     *  (no ffmpeg-graph approximations). Bundles the shared composition entry, selects the composition, and
     *  renders it to mp4 at the given format, feeding the doc as inputProps.
     *
     *  `@remotion/bundler` + `@remotion/renderer` carry headless Chromium and are heavy, so they're loaded via
     *  NON-LITERAL dynamic imports — this module compiles and the ffmpeg engine keeps working even on a worker
     *  that lacks them (returns null; the Job then fails cleanly and the config should stay on the ffmpeg
     *  engine there). Verified working end-to-end locally, AND against the actual built runtime Docker image —
     *  bundling + `require.resolve` of the shared composition entry both work there (see the Dockerfile's
     *  `packages/` copy + `chown` for what that needed).
     *
     *  HARD BLOCKER on the shared `node:22-alpine` runner image specifically: Remotion's Chromium download has
     *  no working build for Alpine/musl libc (confirmed — both the arm64 AND x64 `chrome-headless-shell`
     *  assets 400 from Remotion's/Playwright's CDN for this platform; this is an upstream gap, not a network
     *  fluke). This mirrors why the SVG export pipeline's Puppeteer/`@sparticuz/chromium` render runs as its
     *  own Lambda (a glibc/Amazon-Linux runtime) rather than in this generic Alpine ECS image — the same split
     *  is needed here: the REMOTION engine must run on a glibc base (a separate Dockerfile/Lambda), not this
     *  service's default image. DO NOT flip `MediaConfig.DEFAULT.render.engine` to REMOTION until that worker
     *  exists; today it would fail every job. Also note: the composition resolves
     *  each clip's `src` — the CALLER must refresh signed URLs into `doc` before invoking this (see
     *  `MediaService.resolveClipSources`); this function renders exactly the `src`s it's given. */
    export async function renderCompositeRemotion( doc : StudioProject.VideoDoc, width : number, height : number, fps : number, durationSec : number ) : Promise<Uint8Array | null>
    {
        const runId : string = randomUUID();
        const workDir : string = path.join( os.tmpdir(), `studio-remotion-${ runId }` );
        const outPath : string = path.join( workDir, "out.mp4" );
        try
        {
            // lazy-load via non-literal specifiers so TS/esbuild don't require these (Chromium-carrying) packages
            const bundlerName : string = "@remotion/bundler";
            const rendererName : string = "@remotion/renderer";
            const compositionName : string = "@repo/studio-composition";
            const bundler = await import( bundlerName ) as { bundle : ( options : unknown ) => Promise<string> };
            const renderer = await import( rendererName ) as { selectComposition : ( options : unknown ) => Promise<{ durationInFrames : number }>; renderMedia : ( options : unknown ) => Promise<unknown> };
            const entry = await import( compositionName ) as { ENTRY_POINT : string; COMPOSITION_ID : string };

            await fs.mkdir( workDir, { recursive: true } );
            const totalFrames : number = Math.max( 1, Math.round( Math.max( 0.1, durationSec ) * fps ) );
            const inputProps : { doc : StudioProject.VideoDoc } = { doc };
            // ENTRY_POINT is a bare module specifier ("@repo/studio-composition/Root") — @remotion/bundler needs
            // an absolute file path, so resolve it via Node's own module resolution (honors the package's
            // "./Root" -> "./src/Root.tsx" export map) before handing it to the bundler
            const rootEntryPath : string = require.resolve( entry.ENTRY_POINT );

            // bundle the composition site → pick the composition (overriding its size/fps/length to this format)
            // → render to mp4 via headless Chromium
            const serveUrl : string = await bundler.bundle( { entryPoint: rootEntryPath } );
            const composition : { durationInFrames : number } = await renderer.selectComposition( { serveUrl, id: entry.COMPOSITION_ID, inputProps } );
            await renderer.renderMedia( { serveUrl, codec: "h264", outputLocation: outPath, inputProps,
                composition: { ...composition, width, height, fps, durationInFrames: totalFrames } } );
            const bytes : Buffer = await fs.readFile( outPath );
            return bytes;
        }
        catch( error ) { console.error( "MediaAnalyzer.renderCompositeRemotion unavailable (needs @remotion/* + Chromium + the shared composition entry)", error ); return null; }
        finally { await fs.rm( workDir, { recursive: true, force: true } ).catch( () => { /* best-effort */ } ); }
    }

    ///////////////////////////////////////////////////////////////////////////////////////
    /** The audio track extracted from a video (media-18) — MP3 bytes for the `audio` variant + transcription.
     *  Returns null on failure (ffmpeg unavailable / no audio stream). Spools the video to a temp file, strips
     *  video (`-vn`), encodes MP3, reads it back. */
    export async function extractAudio( bytes : Uint8Array, ext : string ) : Promise<{ bytes : Uint8Array; format : string; mime : string } | null>
    {
        const id : string = randomUUID();
        const videoPath : string = path.join( os.tmpdir(), `media-audio-src-${ id }.${ ext || "mp4" }` );
        const outPath : string = path.join( os.tmpdir(), `media-audio-${ id }.mp3` );
        try
        {
            const ffmpegModule = await import( "fluent-ffmpeg" );
            const ffmpegStatic = await import( "ffmpeg-static" );
            const ffmpeg = ( ( ffmpegModule as { default? : unknown } ).default ?? ffmpegModule ) as typeof import( "fluent-ffmpeg" );
            const ffmpegBin : string | null = ( ffmpegStatic as { default? : string | null } ).default ?? ( ffmpegStatic as unknown as string );
            if( ffmpegBin ) ffmpeg.setFfmpegPath( ffmpegBin );

            await fs.writeFile( videoPath, bytes );
            await new Promise<void>( ( resolve, reject ) =>
            {
                ffmpeg( videoPath )
                    .noVideo()
                    .audioCodec( "libmp3lame" )
                    .audioQuality( 4 )
                    .on( "end", () => resolve() )
                    .on( "error", ( err : Error ) => reject( err ) )
                    .save( outPath );
            } );

            const audioBytes : Buffer = await fs.readFile( outPath );
            return { bytes: audioBytes, format: "mp3", mime: FileUtils.Mime.AUDIO_MPEG };
        }
        catch( error ) { console.error( "MediaAnalyzer.extractAudio failed", error ); return null; }
        finally
        {
            await fs.unlink( videoPath ).catch( () => { /* best-effort */ } );
            await fs.unlink( outPath ).catch( () => { /* best-effort */ } );
        }
    }

    ///////////////////////////////////////////////////////////////////////////////////////
    /** Extract a single frame at `atSec` from an mp4 as a JPEG (media-21 poster/thumbnail). Null on failure. */
    export async function extractPosterFrame( bytes : Uint8Array, atSec : number ) : Promise<Uint8Array | null>
    {
        const id : string = randomUUID();
        const videoPath : string = path.join( os.tmpdir(), `studio-poster-src-${ id }.mp4` );
        const outPath : string = path.join( os.tmpdir(), `studio-poster-${ id }.jpg` );
        try
        {
            const ffmpegModule = await import( "fluent-ffmpeg" );
            const ffmpegStatic = await import( "ffmpeg-static" );
            const ffmpeg = ( ( ffmpegModule as { default? : unknown } ).default ?? ffmpegModule ) as typeof import( "fluent-ffmpeg" );
            const ffmpegBin : string | null = ( ffmpegStatic as { default? : string | null } ).default ?? ( ffmpegStatic as unknown as string );
            if( ffmpegBin ) ffmpeg.setFfmpegPath( ffmpegBin );
            await fs.writeFile( videoPath, bytes );
            await new Promise<void>( ( resolve : () => void, reject : ( error : Error ) => void ) : void =>
            {
                ffmpeg( videoPath )
                    .seekInput( Math.max( 0, atSec ) )   // -ss before the input → fast seek to the poster time
                    .outputOptions( [ "-frames:v 1", "-q:v 2" ] )
                    .on( "end", () : void => resolve() )
                    .on( "error", ( err : Error ) : void => reject( err ) )
                    .save( outPath );
            } );
            const jpg : Buffer = await fs.readFile( outPath );
            return jpg;
        }
        catch( error ) { console.error( "MediaAnalyzer.extractPosterFrame failed", error ); return null; }
        finally
        {
            await fs.unlink( videoPath ).catch( () => { /* best-effort */ } );
            await fs.unlink( outPath ).catch( () => { /* best-effort */ } );
        }
    }

    ///////////////////////////////////////////////////////////////////////////////////////
    /** Convert an mp4 to an animated GIF (media-21 export) — a single-pass `split`/`palettegen`/`paletteuse`
     *  graph for good color; scaled to `maxWidth` at a reduced fps to keep the file sane. Null on failure. */
    export async function toGif( bytes : Uint8Array, maxWidth : number = 640, fps : number = 12 ) : Promise<Uint8Array | null>
    {
        const id : string = randomUUID();
        const videoPath : string = path.join( os.tmpdir(), `studio-gif-src-${ id }.mp4` );
        const outPath : string = path.join( os.tmpdir(), `studio-gif-${ id }.gif` );
        try
        {
            const ffmpegModule = await import( "fluent-ffmpeg" );
            const ffmpegStatic = await import( "ffmpeg-static" );
            const ffmpeg = ( ( ffmpegModule as { default? : unknown } ).default ?? ffmpegModule ) as typeof import( "fluent-ffmpeg" );
            const ffmpegBin : string | null = ( ffmpegStatic as { default? : string | null } ).default ?? ( ffmpegStatic as unknown as string );
            if( ffmpegBin ) ffmpeg.setFfmpegPath( ffmpegBin );
            await fs.writeFile( videoPath, bytes );
            const graph : string = `fps=${ fps },scale=${ maxWidth }:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse`;
            await new Promise<void>( ( resolve : () => void, reject : ( error : Error ) => void ) : void =>
            {
                ffmpeg( videoPath )
                    .complexFilter( graph )
                    .on( "end", () : void => resolve() )
                    .on( "error", ( err : Error ) : void => reject( err ) )
                    .save( outPath );
            } );
            const gif : Buffer = await fs.readFile( outPath );
            return gif;
        }
        catch( error ) { console.error( "MediaAnalyzer.toGif failed", error ); return null; }
        finally
        {
            await fs.unlink( videoPath ).catch( () => { /* best-effort */ } );
            await fs.unlink( outPath ).catch( () => { /* best-effort */ } );
        }
    }

    ///////////////////////////////////////////////////////////////////////////////////////
    /** Rasterize an SVG string to a transparent square PNG (media-21.32 shape overlays) via `sharp` — so a
     *  shape/graphic composites in the ffmpeg overlay graph like any image (transform then places it). `size`
     *  is the raster's edge in px (the shape is fit inside, undistorted, on a transparent canvas). Null on failure. */
    export async function rasterizeSvg( svg : string, size : number ) : Promise<Uint8Array | null>
    {
        try
        {
            const sharp = await loadSharp();
            const png : Buffer = await sharp( Buffer.from( svg ), { density: 300 } )
                .resize( size, size, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } } )
                .png()
                .toBuffer();
            return png;
        }
        catch( error ) { console.error( "MediaAnalyzer.rasterizeSvg failed", error ); return null; }
    }

    ///////////////////////////////////////////////////////////////////////////////////////
    /** Compress a video to a distribution target (media-10.10). Encodes H.264/HEVC, scaling to `maxWidth`,
     *  capping fps + audio, honoring `maxSeconds`. When `maxSizeKb` is set, walks a CRF quality ladder and
     *  returns the FIRST output under the cap (else the smallest achieved, with `underCap=false`). Null on
     *  ffmpeg failure. */
    export async function compressVideo( bytes : Uint8Array, ext : string, target : MediaConfig.VideoTarget )
        : Promise<{ bytes : Uint8Array; format : string; size : number; underCap : boolean } | null>
    {
        const id : string = randomUUID();
        const inPath : string = path.join( os.tmpdir(), `media-vc-src-${ id }.${ ext || "mp4" }` );
        // the CRF quality ladder (media-10.5): coarser steps chase a size cap; a single pass otherwise
        const ladder : Array<number> = target.maxSizeKb ? [ 28, 32, 35, 38 ] : [ 26 ];
        const codec : string = target.codec === MediaConfig.VideoCodec.HEVC ? "libx265" : "libx264";
        try
        {
            const ffmpegModule = await import( "fluent-ffmpeg" );
            const ffmpegStatic = await import( "ffmpeg-static" );
            const ffmpeg = ( ( ffmpegModule as { default? : unknown } ).default ?? ffmpegModule ) as typeof import( "fluent-ffmpeg" );
            const ffmpegBin : string | null = ( ffmpegStatic as { default? : string | null } ).default ?? ( ffmpegStatic as unknown as string );
            if( ffmpegBin ) ffmpeg.setFfmpegPath( ffmpegBin );
            await fs.writeFile( inPath, bytes );

            let smallest : { bytes : Uint8Array; size : number } | null = null;
            for( const crf of ladder )
            {
                const outPath : string = path.join( os.tmpdir(), `media-vc-${ id }-${ crf }.mp4` );
                try
                {
                    await new Promise<void>( ( resolve, reject ) =>
                    {
                        const options : Array<string> = [ `-crf ${ crf }`, "-preset medium", "-pix_fmt yuv420p", "-movflags +faststart" ];
                        if( target.codec === MediaConfig.VideoCodec.HEVC ) options.push( "-tag:v hvc1" );
                        let command = ffmpeg( inPath ).videoCodec( codec ).outputOptions( options ).audioBitrate( `${ target.audioKbps ?? 96 }k` );
                        if( target.maxWidth )   command = command.size( `${ target.maxWidth }x?` );
                        if( target.fpsCap )     command = command.fps( target.fpsCap );
                        if( target.maxSeconds ) command = command.duration( target.maxSeconds );
                        command.on( "end", () => resolve() ).on( "error", ( err : Error ) => reject( err ) ).save( outPath );
                    } );
                    const out : Buffer = await fs.readFile( outPath );
                    if( !smallest || out.length < smallest.size ) smallest = { bytes: out, size: out.length };
                    if( !target.maxSizeKb || out.length <= target.maxSizeKb * 1024 )
                        return { bytes: out, format: "mp4", size: out.length, underCap: true };
                }
                finally { await fs.unlink( outPath ).catch( () => { /* best-effort */ } ); }
            }
            if( smallest ) return { bytes: smallest.bytes, format: "mp4", size: smallest.size, underCap: false };
            return null;
        }
        catch( error ) { console.error( "MediaAnalyzer.compressVideo failed", error ); return null; }
        finally { await fs.unlink( inPath ).catch( () => { /* best-effort */ } ); }
    }

    ///////////////////////////////////////////////////////////////////////////////////////
    /** Probe a video buffer with ffprobe → VideoMeta, or null if ffprobe is unavailable / the bytes don't parse.
     *  ffprobe needs a real file, so the bytes are spooled to a temp file (deleted after) named with `ext`. */
    export async function analyzeVideo( bytes : Uint8Array, ext : string ) : Promise<Media.VideoMeta | null>
    {
        const tempPath : string = path.join( os.tmpdir(), `media-probe-${ randomUUID() }.${ ext || "bin" }` );
        try
        {
            const ffmpegModule = await import( "fluent-ffmpeg" );
            const ffprobeStatic = await import( "ffprobe-static" );
            const ffmpeg = ( ( ffmpegModule as { default? : unknown } ).default ?? ffmpegModule ) as typeof import( "fluent-ffmpeg" );
            const probePath : string = ( ffprobeStatic as { path? : string; default? : { path? : string } } ).path
                ?? ( ffprobeStatic as { default? : { path? : string } } ).default?.path
                ?? "ffprobe";
            ffmpeg.setFfprobePath( probePath );

            await fs.writeFile( tempPath, bytes );

            const data : FfprobeData = await new Promise<FfprobeData>( ( resolve, reject ) =>
                ffmpeg.ffprobe( tempPath, ( err : Error | null, info : FfprobeData ) => err ? reject( err ) : resolve( info ) ) );

            const video : FfprobeStream | undefined = ( data.streams ?? [] ).find( ( stream ) => stream.codec_type === "video" );
            const audio : FfprobeStream | undefined = ( data.streams ?? [] ).find( ( stream ) => stream.codec_type === "audio" );

            return {
                width:       video?.width,
                height:      video?.height,
                durationSec: toNumber( data.format?.duration ),
                frameRate:   parseFrameRate( video?.avg_frame_rate ?? video?.r_frame_rate ),
                videoCodec:  video?.codec_name,
                audioCodec:  audio?.codec_name,
                bitrate:     toNumber( data.format?.bit_rate ),
                pixelFormat: video?.pix_fmt,
                rotation:    toNumber( ( video?.tags as { rotate? : string } | undefined )?.rotate ),
                container:   data.format?.format_name,
            };
        }
        catch( error ) { console.error( "MediaAnalyzer.analyzeVideo failed", error ); return null; }
        finally { await fs.unlink( tempPath ).catch( () => { /* best-effort temp cleanup */ } ); }
    }

    ///////////////////////////////////////////////////////////////////////////////////////
    /** Probe an AUDIO file's metadata via `ffprobe` (duration / bitrate / sample rate / channels / codec),
     *  or null on failure. Spools the bytes to a temp file, reads the first audio stream + the container
     *  format, then cleans up. Mirrors {@link analyzeVideo} for the audio case. */
    export async function analyzeAudio( bytes : Uint8Array, ext : string ) : Promise<Media.AudioMeta | null>
    {
        const tempPath : string = path.join( os.tmpdir(), `media-probe-${ randomUUID() }.${ ext || "bin" }` );
        try
        {
            const ffmpegModule = await import( "fluent-ffmpeg" );
            const ffprobeStatic = await import( "ffprobe-static" );
            const ffmpeg = ( ( ffmpegModule as { default? : unknown } ).default ?? ffmpegModule ) as typeof import( "fluent-ffmpeg" );
            const probePath : string = ( ffprobeStatic as { path? : string; default? : { path? : string } } ).path
                ?? ( ffprobeStatic as { default? : { path? : string } } ).default?.path
                ?? "ffprobe";
            ffmpeg.setFfprobePath( probePath );

            await fs.writeFile( tempPath, bytes );

            const data : FfprobeData = await new Promise<FfprobeData>( ( resolve, reject ) =>
                ffmpeg.ffprobe( tempPath, ( err : Error | null, info : FfprobeData ) => err ? reject( err ) : resolve( info ) ) );

            // the first audio stream carries the codec/rate/channels; duration+bitrate come from the container
            const audio : FfprobeStream | undefined = ( data.streams ?? [] ).find( ( stream ) => stream.codec_type === "audio" );
            return {
                durationSec: toNumber( data.format?.duration ),
                bitrate:     toNumber( data.format?.bit_rate ),
                sampleRate:  toNumber( audio?.sample_rate ),
                channels:    toNumber( audio?.channels ),
                codec:       audio?.codec_name,
            };
        }
        catch( error ) { console.error( "MediaAnalyzer.analyzeAudio failed", error ); return null; }
        finally { await fs.unlink( tempPath ).catch( () => { /* best-effort temp cleanup */ } ); }
    }

    /////////////////////////////////////////////////////////////////////////////////////////////
    // coerce ffprobe's string|number fields to a finite number (else undefined)
    function toNumber( value : unknown ) : number | undefined
    {
        const parsed : number = typeof value === "number" ? value : Number( value );
        return Number.isFinite( parsed ) ? parsed : undefined;
    }

    /////////////////////////////////////////////////////////////////////////////////////////////
    // ffprobe reports fps as a rational string ("30000/1001"); reduce to a rounded fps (2 dp)
    function parseFrameRate( rate? : string ) : number | undefined
    {
        if( !rate ) return undefined;
        const [ numerator, denominator ] : Array<string> = rate.split( "/" );
        const top : number = Number( numerator );
        const bottom : number = denominator !== undefined ? Number( denominator ) : 1;
        if( !Number.isFinite( top ) || !Number.isFinite( bottom ) || bottom === 0 ) return undefined;
        return Math.round( ( top / bottom ) * 100 ) / 100;
    }
}

export default MediaAnalyzer;
