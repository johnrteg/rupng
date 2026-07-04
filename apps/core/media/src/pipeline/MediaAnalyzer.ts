//
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { randomUUID } from "node:crypto";

import type { FfprobeData, FfprobeStream } from "fluent-ffmpeg";

import { AiFactory, Ai } from "@repo/ai";
import { FileUtils, type Type } from "@repo/common";
import { Media, MediaConfig } from "@repo/api";

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
