//
import { randomUUID } from "node:crypto";

import { Media, MediaConfig, SvgAsset } from "@repo/api";
import { Dynamo, S3, Sqs, Trace } from "@repo/services";
import { FileUtils, type Type } from "@repo/common";
import { Ai } from "@repo/ai";

import { MediaAnalyzer } from "./MediaAnalyzer";
import { Scanner } from "@repo/services";
import SvgThreatScanner from "../utils/SvgThreatScanner";

//
// MediaPipeline — the ingest processing shared by both runtimes (the Main service drains the queues locally;
// the Lambda Jobs run the same steps in prod). Operates on the ENVELOPE model (media-1): an Asset holds a set
// of ITEMS; the pipeline reads the ORIGINAL item and writes DERIVED items (DISPLAY/PLATFORM renditions, a
// video POSTER, probed metadata) via upsert (replace + version by usage[.profile]).
//
export namespace MediaPipeline
{
    /** Facades + live config the pipeline needs — supplied by MediaService (dev consumers) or MediaJob. */
    export interface Deps
    {
        dynamo : Dynamo;
        s3     : S3;
        sqs    : Sqs;
        log    : Trace;
        config : MediaConfig.Config;
        // The AI client for the CHAT modality (auto-tag vision) — undefined when auto-tag is off; suggestTags falls back.
        chatAi? : Ai;
        // The malware scanner for the ingest gate (media-5) — the config-selected adapter; NoopScanner when off.
        scanner? : Scanner;
    }

    const TABLE : string = "media";
    // the generic profile media derives on ingest → DISPLAY items; platform profiles → PLATFORM items.
    const DISPLAY_PROFILE : string = "display";

    ///////////////////////////////////////////////////////////////////////////////////////////
    /** Does a source mime match a spec matcher (`"image/*"` / exact / `"*"`)? */
    export function mimeMatches( pattern : string, mime : string ) : boolean
    {
        if( !pattern || pattern === "*" || pattern === "*/*" ) return true;
        if( pattern.endsWith( "/*" ) ) return mime.startsWith( pattern.slice( 0, -1 ) );   // "image/" prefix
        return pattern === mime;
    }

    ///////////////////////////////////////////////////////////////////////////////////////////
    /** The typed S3 object key for an item in an envelope. Account/campaign media → MEDIA layout
     *  (`acct/<accountId>/media/<guid>/<stem>.<ext>`); a user avatar → AVATAR layout. `stem` is the item key
     *  (`usage[.profile]`, e.g. "original" / "display.thumb" / "compressed.mms"); `ext` is the item's ext. */
    export function objectKey( asset : Media.Asset, stem : string, ext : string ) : S3.ObjectKey
    {
        const extension : string = ext || "bin";
        const key : string = stem || "original";
        if( asset.scope === Media.Scope.USER && asset.scopeId )
            return { domain: S3.Domain.AVATAR, userId: asset.scopeId, variant: key, ext: extension };
        return { domain: S3.Domain.MEDIA, accountId: asset.accountId, mediaId: asset.guid, variant: key, ext: extension };
    }

    ///////////////////////////////////////////////////////////////////////////////////////////
    /** The S3 key for a specific item (its usage[.profile] stem + its extension). */
    export function itemKey( asset : Media.Asset, item : Media.Item ) : S3.ObjectKey
    {
        return objectKey( asset, Media.itemKey( item.usage, item.profile ), item.extension );
    }

    ///////////////////////////////////////////////////////////////////////////////////////////
    /** Enqueue the scan stage for a freshly-uploaded envelope. */
    export async function enqueueScan( deps : MediaPipeline.Deps, accountId : string, guid : string ) : Promise<void>
    {
        await deps.sqs.send( "media-scan", { accountId, guid } );
    }

    ///////////////////////////////////////////////////////////////////////////////////////////
    // The scan gate (media-5). Scan the ORIGINAL bytes with the config-selected engine (NoopScanner when
    // scanning is off): CLEAN → advance to processing; THREAT → quarantine (never promoted / delivered);
    // ENGINE ERROR → fail-closed (throw → redeliver, stays SCANNING) or fail-open per config.
    export async function scan( deps : MediaPipeline.Deps, accountId : string, guid : string ) : Promise<void>
    {
        const got : Type.Result<Media.Asset | undefined> = await deps.dynamo.get<Media.Asset>( TABLE, { accountId, guid } );
        if( !got.ok ) throw new Error( `media read failed ${ accountId }/${ guid }` );   // throw → redeliver
        if( !got.data || got.data.status !== Media.Status.SCANNING ) return;             // gone / not awaiting scan → no-op
        const asset : Media.Asset = got.data;

        // read the ORIGINAL bytes to scan (a missing original is an anomaly → redeliver)
        const original : Media.Item | undefined = Media.originalItem( asset );
        if( !original ) throw new Error( `media has no original ${ accountId }/${ guid }` );
        const object : Type.Result<{ Body? : { transformToByteArray() : Promise<Uint8Array> } }> = await deps.s3.get( "media", itemKey( asset, original ) );
        if( !object.ok || !object.data.Body ) throw new Error( `original bytes unavailable ${ accountId }/${ guid }` );
        const bytes : Uint8Array = await object.data.Body.transformToByteArray();

        // SVG-content gate — the malware scanner above is generic AV, not SVG-aware, so it won't catch a
        // <script>/event-handler/external-reference that has no legitimate place in a static graphic (see
        // SvgThreatScanner). Checked BEFORE the generic scanner so a hit never reaches MediaAnalyzer.
        // rasterizeSvgToThumbnail (raw bytes piped straight into libvips/librsvg — a real SSRF surface for
        // any external reference the markup carries).
        if( original.mime === FileUtils.Mime.IMAGE_SVG )
        {
            const svgThreats : Array<SvgAsset.RejectReason> = SvgThreatScanner.scan( new TextDecoder().decode( bytes ) );
            if( svgThreats.length > 0 )
            {
                deps.log.warn( "media.scan SVG THREAT — quarantined", { accountId, guid, reasons: svgThreats } );
                const scannedAt : string = new Date().toISOString();
                const threatScan : Media.ScanResult = { clean: false, provider: deps.config.scan.provider, engine: "svg-threat-scanner", threat: svgThreats.join( ", " ), scannedAt };
                await deps.dynamo.put( TABLE, { ...asset, status: Media.Status.QUARANTINED, scanThreat: svgThreats.join( ", " ), scan: threatScan, modifiedAt: scannedAt } );
                return;
            }
        }

        // scan with the config-selected engine (Noop = pass-through when disabled)
        const scanner : Scanner = deps.scanner ?? { provider: Scanner.Provider.NONE, scan: () => Promise.resolve( { ok: true, data: { clean: true, engine: "noop" } } ) };
        const verdict : Type.Result<Scanner.Verdict> = await scanner.scan( bytes, asset.name );
        const provider : string = deps.config.scan.provider;   // the configured engine id — recorded on the result
        const scannedAt : string = new Date().toISOString();

        // engine error → fail-closed (default): throw so the message redelivers and the file stays SCANNING
        if( !verdict.ok )
        {
            deps.log.warn( "media.scan engine error", { accountId, guid, provider, error: verdict.error } );
            if( deps.config.scan.failClosed !== false ) throw new Error( `scan engine unavailable ${ accountId }/${ guid }` );
            deps.log.warn( "media.scan fail-OPEN — advancing unscanned", { accountId, guid } );   // explicit: not silently dropped

            // fail-open: advance to processing but RECORD that it went through unscanned (visible in Info)
            const failOpenScan : Media.ScanResult = { clean: true, provider, failOpen: true, scannedAt };
            await deps.dynamo.put( TABLE, { ...asset, status: Media.Status.PROCESSING, scanThreat: undefined, scan: failOpenScan, modifiedAt: scannedAt } );
            await deps.sqs.send( "media-process", { accountId, guid } );
            return;
        }

        // detection → quarantine (never promoted / delivered), record the threat + result, and stop
        if( !verdict.data.clean )
        {
            deps.log.warn( "media.scan THREAT — quarantined", { accountId, guid, engine: verdict.data.engine, threat: verdict.data.threat } );
            const threatScan : Media.ScanResult = { clean: false, provider, engine: verdict.data.engine, threat: verdict.data.threat, scannedAt };
            await deps.dynamo.put( TABLE, { ...asset, status: Media.Status.QUARANTINED, scanThreat: verdict.data.threat, scan: threatScan, modifiedAt: scannedAt } );
            return;
        }

        // clean → record the clean result + advance to processing
        const cleanScan : Media.ScanResult = { clean: true, provider, engine: verdict.data.engine, scannedAt };
        await deps.dynamo.put( TABLE, { ...asset, status: Media.Status.PROCESSING, scanThreat: undefined, scan: cleanScan, modifiedAt: scannedAt } );
        await deps.sqs.send( "media-process", { accountId, guid } );
        deps.log.info( "media.scan clean → processing", { accountId, guid, engine: verdict.data.engine } );
    }

    ///////////////////////////////////////////////////////////////////////////////////////////
    /** Enqueue the process stage for a NAMED profile (on-demand PLATFORM items) — profile rides in the body. */
    export async function enqueueProcess( deps : MediaPipeline.Deps, accountId : string, guid : string, profileName : string ) : Promise<void>
    {
        await deps.sqs.send( "media-process", { accountId, guid, profile: profileName } );
    }

    ///////////////////////////////////////////////////////////////////////////////////////////
    /** Enqueue a metadata re-probe (the UI "rescan" action) — re-probes the ORIGINAL item's meta only. */
    export async function enqueueRescan( deps : MediaPipeline.Deps, accountId : string, guid : string ) : Promise<void>
    {
        await deps.sqs.send( "media-process", { accountId, guid, rescan: true } );
    }

    ///////////////////////////////////////////////////////////////////////////////////////////
    /** Fetch an envelope's ORIGINAL bytes from S3, or null (logged) if unavailable. */
    async function fetchOriginal( deps : MediaPipeline.Deps, asset : Media.Asset ) : Promise<Uint8Array | null>
    {
        const original : Media.Item | undefined = Media.originalItem( asset );
        if( !original ) { deps.log.warn( "media: no original item", { guid: asset.guid } ); return null; }
        const got : Type.Result<{ Body? : { transformToByteArray() : Promise<Uint8Array> } }> = await deps.s3.get( "media", itemKey( asset, original ) );
        if( !got.ok || !got.data.Body ) { deps.log.warn( "media: original unavailable", { guid: asset.guid } ); return null; }
        return await got.data.Body.transformToByteArray();
    }

    ///////////////////////////////////////////////////////////////////////////////////////////
    /** The delivery mime for a produced image format. */
    function mimeForFormat( format : string ) : string
    {
        switch( format )
        {
            case "jpeg": case "jpg": return FileUtils.Mime.IMAGE_JPEG;
            case "png":              return FileUtils.Mime.IMAGE_PNG;
            case "webp":             return FileUtils.Mime.IMAGE_WEBP;
            case "gif":              return FileUtils.Mime.IMAGE_GIF;
            case "avif":             return FileUtils.Mime.IMAGE_AVIF;
            default:                 return FileUtils.Mime.OCTET_STREAM;
        }
    }

    ///////////////////////////////////////////////////////////////////////////////////////////
    /** Build a fresh derived Item (id + timestamps + version 1). Callers set meta/derivation as needed. */
    function makeItem( fields : Pick<Media.Item, "usage" | "profile" | "kind" | "mime" | "extension" | "size" | "status"> & Partial<Pick<Media.Item, "meta" | "derivation">> ) : Media.Item
    {
        const now : string = new Date().toISOString();
        return { id: randomUUID(), version: 1, createdAt: now, modifiedAt: now, ...fields };
    }

    ///////////////////////////////////////////////////////////////////////////////////////////
    /** Probe the ORIGINAL item's per-kind metrics (IMAGE → sharp, VIDEO/AUDIO → ffprobe; else none). `bytes`
     *  may be supplied by a caller that already fetched the original. Returns an {@link Media.ItemMeta} (or {}). */
    async function probeMeta( deps : MediaPipeline.Deps, asset : Media.Asset, bytes? : Uint8Array | null ) : Promise<Media.ItemMeta>
    {
        const original : Media.Item | undefined = Media.originalItem( asset );
        const probeable : boolean = !!original && ( original.kind === Media.Kind.IMAGE || original.kind === Media.Kind.VIDEO || original.kind === Media.Kind.AUDIO );
        if( !original || !probeable ) return {};
        const source : Uint8Array | null = bytes ?? await fetchOriginal( deps, asset );
        if( !source ) return {};

        if( original.kind === Media.Kind.IMAGE )
        {
            const image : Media.ImageMeta | null = await MediaAnalyzer.analyzeImage( source );
            return image ? { image } : {};
        }
        if( original.kind === Media.Kind.AUDIO )
        {
            const audio : Media.AudioMeta | null = await MediaAnalyzer.analyzeAudio( source, original.extension );
            return audio ? { audio } : {};
        }
        const video : Media.VideoMeta | null = await MediaAnalyzer.analyzeVideo( source, original.extension );
        return video ? { video } : {};
    }

    ///////////////////////////////////////////////////////////////////////////////////////////
    /** Re-probe the ORIGINAL item's metadata on demand (the UI "rescan" action) and merge it onto the item. */
    export async function analyze( deps : MediaPipeline.Deps, accountId : string, guid : string ) : Promise<void>
    {
        const got : Type.Result<Media.Asset | undefined> = await deps.dynamo.get<Media.Asset>( TABLE, { accountId, guid } );
        if( !got.ok ) throw new Error( `media read failed ${ accountId }/${ guid }` );
        if( !got.data ) return;
        const asset : Media.Asset = got.data;
        const original : Media.Item | undefined = Media.originalItem( asset );
        if( !original ) return;

        const meta : Media.ItemMeta = await probeMeta( deps, asset );
        const updatedOriginal : Media.Item = { ...original, meta: { ...original.meta, ...meta }, modifiedAt: new Date().toISOString() };
        await deps.dynamo.put( TABLE, { ...asset, items: Media.upsertItems( asset.items, updatedOriginal ), modifiedAt: new Date().toISOString() } );
        deps.log.info( "media.analyze done", { accountId, guid, kind: original.kind, probed: Object.keys( meta ).length > 0 } );
    }

    ///////////////////////////////////////////////////////////////////////////////////////////
    /** Render an image to a configured DPI/density target (media-4) — the async worker for the "change
     *  density" action. Re-renders the ORIGINAL via sharp (MediaAnalyzer.setDensity) and upserts a DENSITY item
     *  keyed `density.<target>`. No-op if the asset isn't an image or the target is unknown. */
    export async function densify( deps : MediaPipeline.Deps, accountId : string, guid : string, densityKey : string ) : Promise<void>
    {
        const target : MediaConfig.DensityTarget | undefined = ( deps.config.densities ?? {} )[ densityKey ];
        if( !target ) { deps.log.warn( "media.density unknown target", { accountId, guid, densityKey } ); return; }

        const got : Type.Result<Media.Asset | undefined> = await deps.dynamo.get<Media.Asset>( TABLE, { accountId, guid } );
        if( !got.ok ) throw new Error( `media read failed ${ accountId }/${ guid }` );   // throw → redeliver
        if( !got.data ) return;
        const asset : Media.Asset = got.data;
        const original : Media.Item | undefined = Media.originalItem( asset );
        if( !original || original.kind !== Media.Kind.IMAGE ) { deps.log.warn( "media.density not an image", { accountId, guid } ); return; }

        // read the original bytes + re-render at the target DPI
        const bytes : Uint8Array | null = await fetchOriginal( deps, asset );
        if( !bytes ) { deps.log.warn( "media.density original unavailable", { accountId, guid } ); return; }
        const rendition : MediaAnalyzer.Rendition | null = await MediaAnalyzer.setDensity( bytes, target.dpi, target.upscale ?? true );
        if( !rendition ) { deps.log.warn( "media.density render failed", { accountId, guid, densityKey } ); return; }

        // store as a DENSITY item keyed by the target (density.<key>), upsert (replace + version)
        const item : Media.Item = makeItem( {
            usage: Media.Usage.DENSITY, profile: densityKey, kind: Media.Kind.IMAGE,
            mime: mimeForFormat( rendition.format ), extension: rendition.format, size: rendition.size, status: Media.Status.OK,
            meta: { image: { width: rendition.width, height: rendition.height, format: rendition.format, density: target.dpi } },
            derivation: { job: "density", params: { density: densityKey, dpi: target.dpi }, sourceItemId: original.id },
        } );
        const put : Type.Result<void> = await deps.s3.put( "media", itemKey( asset, item ), Buffer.from( rendition.bytes ), item.mime );
        item.status = put.ok ? Media.Status.OK : Media.Status.FAILED;
        await deps.dynamo.put( TABLE, { ...asset, items: Media.upsertItems( asset.items, item ), modifiedAt: new Date().toISOString() } );
        deps.log.info( "media.density done", { accountId, guid, densityKey, dpi: target.dpi } );
    }

    ///////////////////////////////////////////////////////////////////////////////////////////
    /** Regenerate a VIDEO's POSTER item from a specific frame (`atSeconds`) — the "set poster frame" action. */
    export async function regeneratePoster( deps : MediaPipeline.Deps, accountId : string, guid : string, atSeconds : number ) : Promise<void>
    {
        const got : Type.Result<Media.Asset | undefined> = await deps.dynamo.get<Media.Asset>( TABLE, { accountId, guid } );
        if( !got.ok ) throw new Error( `media read failed ${ accountId }/${ guid }` );
        if( !got.data || got.data.kind !== Media.Kind.VIDEO ) return;
        const asset : Media.Asset = got.data;
        const original : Media.Item | undefined = Media.originalItem( asset );
        if( !original ) return;

        const originalBytes : Uint8Array | null = await fetchOriginal( deps, asset );
        if( !originalBytes ) return;
        const poster : MediaAnalyzer.Rendition | null = await MediaAnalyzer.extractVideoPoster( originalBytes, original.extension, atSeconds );
        if( !poster ) { deps.log.warn( "media.poster: extraction failed", { accountId, guid, atSeconds } ); return; }

        const item : Media.Item = makeItem( {
            usage: Media.Usage.POSTER, kind: Media.Kind.IMAGE, mime: mimeForFormat( poster.format ), extension: poster.format,
            size: poster.size, status: Media.Status.OK, meta: { image: { width: poster.width, height: poster.height, format: poster.format } },
            derivation: { job: "poster", sourceItemId: original.id },
        } );
        const put : Type.Result<void> = await deps.s3.put( "media", itemKey( asset, item ), Buffer.from( poster.bytes ), item.mime );
        item.status = put.ok ? Media.Status.OK : Media.Status.FAILED;
        await deps.dynamo.put( TABLE, { ...asset, items: Media.upsertItems( asset.items, item ), modifiedAt: new Date().toISOString() } );
        deps.log.info( "media.poster regenerated", { accountId, guid, atSeconds, size: poster.size } );
    }

    ///////////////////////////////////////////////////////////////////////////////////////////
    // Image/display processing (media-4). Derives a profile's renditions from the ORIGINAL item into DERIVED
    // items: the generic `display` profile → DISPLAY items (profile = spec label); a named platform profile →
    // PLATFORM items (profile = `<profileName>[.label]`). Initial pass also extracts a video POSTER + probes
    // the original's metadata + auto-tags. Produced items are upserted (replace + version) onto the envelope.
    export async function process( deps : MediaPipeline.Deps, accountId : string, guid : string, profileName? : string ) : Promise<void>
    {
        const got : Type.Result<Media.Asset | undefined> = await deps.dynamo.get<Media.Asset>( TABLE, { accountId, guid } );
        if( !got.ok ) throw new Error( `media read failed ${ accountId }/${ guid }` );
        if( !got.data ) return;                                                     // gone → no-op
        const asset : Media.Asset = got.data;
        const original : Media.Item | undefined = Media.originalItem( asset );
        if( !original ) return;

        // a USER-scope image is an AVATAR envelope — it gets square CROPPED renditions (once a crop is framed),
        // never the generic DISPLAY variants
        const isAvatarAsset : boolean = asset.scope === Media.Scope.USER && original.kind === Media.Kind.IMAGE;

        const onDemand : boolean = profileName !== undefined && profileName !== "";
        const selected : string = onDemand ? ( profileName as string ) : DISPLAY_PROFILE;

        // initial ingest must be awaiting processing; on-demand runs against a servable (OK) envelope.
        if( !onDemand && asset.status !== Media.Status.PROCESSING ) return;
        if( onDemand && asset.status !== Media.Status.OK && asset.status !== Media.Status.PROCESSING ) return;

        // an SVG original is a vector, not a photo — one raster thumbnail is enough for grid previews (the
        // mobile/tablet/desktop ladder is meaningless for something that scales natively), and it needs the
        // SVG-aware rasterizer below (a plain resizeImage decodes a vector at a flat 72 DPI regardless of
        // target size, so a small-viewBox icon comes out ~tiny at every "variant" width)
        const isSvgOriginal : boolean = original.mime === "image/svg+xml";

        // pick the profile's specs FROM CONFIG (the generic `display` falls back to the model defaults), matched
        // to the original's mime. `ondemand` strategy defers the initial pass; an explicit request always runs.
        const specsForProfile : Array<Media.VariantSpec> = isSvgOriginal
            ? [ Media.DISPLAY_VARIANTS[ 0 ] ]   // "thumb" only
            : ( deps.config.variants.profiles[ selected ] ?? ( selected === DISPLAY_PROFILE ? [ ...Media.DISPLAY_VARIANTS ] : [] ) );
        const runNow : boolean = onDemand || deps.config.variants.strategy === "preprocess";
        const specs : Array<Media.VariantSpec> = ( runNow && !isAvatarAsset )
            ? ( isSvgOriginal ? specsForProfile : specsForProfile.filter( ( spec ) => mimeMatches( spec.mime, original.mime ) ) )
            : [];

        // fetch the original ONCE — reused to resize renditions + probe stats (image/video only)
        const isVisual : boolean = original.kind === Media.Kind.IMAGE || original.kind === Media.Kind.VIDEO;
        const originalBytes : Uint8Array | null = ( isVisual && ( specs.length > 0 || !onDemand ) ) ? await fetchOriginal( deps, asset ) : null;

        // produce each rendition as a DISPLAY (generic) or PLATFORM (named) IMAGE item
        const produced : Array<Media.Item> = [];
        for( const spec of specs )
        {
            const usage : Media.Usage = onDemand ? Media.Usage.PLATFORM : Media.Usage.DISPLAY;
            const profile : string | undefined = onDemand ? ( spec.label ? `${ selected }.${ spec.label }` : selected ) : ( spec.label ?? "default" );
            if( original.kind === Media.Kind.IMAGE && originalBytes )
            {
                const rendition : MediaAnalyzer.Rendition | null = isSvgOriginal
                    ? await MediaAnalyzer.rasterizeSvgToThumbnail( originalBytes, spec.width ?? 256 )
                    : await MediaAnalyzer.resizeImage( originalBytes, spec );
                if( rendition )
                {
                    const item : Media.Item = makeItem( {
                        usage, profile, kind: Media.Kind.IMAGE, mime: mimeForFormat( rendition.format ), extension: rendition.format,
                        size: rendition.size, status: Media.Status.OK,
                        meta: { image: { width: rendition.width, height: rendition.height, format: rendition.format } },
                        derivation: { job: "process", sourceItemId: original.id },
                    } );
                    const put : Type.Result<void> = await deps.s3.put( "media", itemKey( asset, item ), Buffer.from( rendition.bytes ), item.mime );
                    item.status = put.ok ? Media.Status.OK : Media.Status.FAILED;
                    produced.push( item );
                    continue;
                }
            }
            // non-image (or resize failed) — record the intended rendition as not-yet-ready (no transcode here)
            produced.push( makeItem( {
                usage, profile, kind: original.kind, mime: original.mime, extension: spec.format ?? original.extension,
                size: 0, status: Media.Status.PROCESSING,
                meta: { image: spec.width ? { width: spec.width, height: spec.height ?? 0 } : undefined },
                derivation: { job: "process", sourceItemId: original.id },
            } ) );
        }

        // AVATAR → square cropped renditions (xl→xs) from the framed crop rect (initial pass, once a crop is set)
        if( isAvatarAsset && asset.avatarCrop && originalBytes && !onDemand )
        {
            for( const spec of Media.AVATAR_VARIANTS.filter( ( entry ) => mimeMatches( entry.mime, original.mime ) ) )
            {
                const rendition : MediaAnalyzer.Rendition | null = await MediaAnalyzer.cropResizeImage( originalBytes, asset.avatarCrop, spec );
                if( !rendition ) continue;
                const item : Media.Item = makeItem( {
                    usage: Media.Usage.AVATAR, profile: spec.label, kind: Media.Kind.IMAGE, mime: mimeForFormat( rendition.format ), extension: rendition.format,
                    size: rendition.size, status: Media.Status.OK,
                    meta: { image: { width: rendition.width, height: rendition.height, format: rendition.format } },
                    derivation: { job: "avatar", sourceItemId: original.id },
                } );
                const put : Type.Result<void> = await deps.s3.put( "media", itemKey( asset, item ), Buffer.from( rendition.bytes ), item.mime );
                item.status = put.ok ? Media.Status.OK : Media.Status.FAILED;
                produced.push( item );
            }
        }

        // VIDEO → a first-frame POSTER (initial pass only) so the grid has a thumbnail
        if( original.kind === Media.Kind.VIDEO && originalBytes && !onDemand )
        {
            const poster : MediaAnalyzer.Rendition | null = await MediaAnalyzer.extractVideoPoster( originalBytes, original.extension );
            if( poster )
            {
                const item : Media.Item = makeItem( {
                    usage: Media.Usage.POSTER, kind: Media.Kind.IMAGE, mime: mimeForFormat( poster.format ), extension: poster.format,
                    size: poster.size, status: Media.Status.OK, meta: { image: { width: poster.width, height: poster.height, format: poster.format } },
                    derivation: { job: "poster", sourceItemId: original.id },
                } );
                const put : Type.Result<void> = await deps.s3.put( "media", itemKey( asset, item ), Buffer.from( poster.bytes ), item.mime );
                item.status = put.ok ? Media.Status.OK : Media.Status.FAILED;
                produced.push( item );
            }
        }

        // merge produced items onto the envelope (upsert replaces same-key items, bumps version)
        let items : Array<Media.Item> = asset.items;
        for( const item of produced ) items = Media.upsertItems( items, item );

        // initial ingest also probes the ORIGINAL item's stats (reuse the fetched bytes) + auto-tags images
        if( !onDemand )
        {
            const meta : Media.ItemMeta = await probeMeta( deps, asset, originalBytes );
            if( Object.keys( meta ).length > 0 )
                items = Media.upsertItems( items, { ...original, meta: { ...original.meta, ...meta }, modifiedAt: new Date().toISOString() } );
        }

        let tags : Array<string> = asset.tags ?? [];
        if( !onDemand && deps.config.autoTag.enabled && original.kind === Media.Kind.IMAGE && originalBytes )
        {
            const suggested : Array<string> = await MediaAnalyzer.suggestTags( originalBytes, original.mime, deps.config.autoTag.maxTags, deps.chatAi );
            if( suggested.length > 0 ) tags = Array.from( new Set( [ ...tags, ...suggested ] ) );
        }

        await deps.dynamo.put( TABLE, { ...asset, status: Media.Status.OK, items, tags, modifiedAt: new Date().toISOString() } );
        deps.log.info( "media.process done", { accountId, guid, kind: original.kind, profile: selected, produced: produced.length, items: items.length, tags: tags.length } );
    }
}

export default MediaPipeline;
