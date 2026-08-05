//
import type { Browser, Page as ChromiumPage } from "puppeteer";

import { SvgDocument, GetSvgRenderJob, compilePageArtwork, collectFontFamilies } from "@repo/api";
import { Dynamo, S3 } from "@repo/services";
import { FileUtils, ResultUtils, Trace } from "@repo/common";
import type { Type } from "@repo/common";

import SvgService from "../services/SvgService";

//
// SvgRenderPipeline — the export-render pipeline for the SVG editor (SVG_EDITOR_SPEC §10): compile the
// requested pages to SVG, dress them with print-production furniture (bleed/crop marks/registration
// marks/color bars), rasterize/paginate with a caller-owned Puppeteer `browser`, upload to S3, and flip the
// svg-render-jobs row to DONE/FAILED. A plain-function module (not a class bound to MediaService) so it can
// run identically from MediaMainService's in-process consumer AND the SvgRenderJob Lambda — the same shape
// as MediaPipeline.scan/process, which are already called from both a Service consumer loop and a Job.
//
export namespace SvgRenderPipeline
{
    /** The narrow slice of facades this pipeline needs — satisfied by MediaService (MAIN's consumer) and by
     *  MediaJob's `pipelineDeps()` (a superset: {dynamo,s3,sqs,log,config,chatAi}), so both callers just pass
     *  themselves/their deps bag through without any adapter. */
    export interface Deps
    {
        dynamo : Dynamo;
        s3     : S3;
        log    : Trace;
    }

    // print-production furniture sizing (pt) — fixed, simple defaults; not user-configurable in this MVP
    const MARK_MARGIN_PT     : number = 24;   // extra canvas margin reserved when any mark/bar is requested
    const MARK_GAP_PT        : number = 6;    // gap between the bleed-box edge and where a crop mark starts
    const MARK_LENGTH_PT     : number = 18;
    const REG_MARK_RADIUS_PT : number = 6;
    const COLOR_BAR_HEIGHT_PT : number = 10;

    ///////////////////////////////////////////////////////////////////////////////////////
    /** Do the actual export render for a queued job: load the doc, compile the requested pages to SVG
     *  (via the shared `compilePage` — the exact same compiler the editor canvas uses), rasterize/paginate
     *  them with the given (caller-owned, shared) Puppeteer `browser`, upload the result to S3, and flip the
     *  svg-render-jobs row to DONE (+ outputUrl) or FAILED (+ error). Never throws — every failure path still
     *  flips the row so a poller doesn't spin forever. */
    export async function runRenderJob( deps : Deps, browser : Browser, jobId : string, accountId : string, projectId : string, pageIds : Array<string> | null, settings : SvgDocument.ExportSettings ) : Promise<void>
    {
        // load the existing PENDING row so every status flip below merges onto it (never fabricates fields)
        const got : Type.Result<SvgService.RenderJobRow | undefined> = await deps.dynamo.get<SvgService.RenderJobRow>( "svg-render-jobs", { pk: jobId } );
        if( !got.ok || got.data === undefined ) { deps.log.warn( "svg render: job row missing", { jobId } ); return; }
        const row : SvgService.RenderJobRow = got.data;

        const setStatus = async ( status : GetSvgRenderJob.RenderStatus, outputUrl : string | null, error : string | null ) : Promise<void> =>
        {
            const wrote : Type.Result<void> = await deps.dynamo.put( "svg-render-jobs", { ...row, status, outputUrl, error } );
            if( !wrote.ok ) deps.log.warn( "svg render: status update failed", { jobId, status, error: wrote.error } );
        };

        // mark PROCESSING so a poll mid-render shows real progress instead of a frozen PENDING
        await setStatus( GetSvgRenderJob.RenderStatus.PROCESSING, null, null );

        // load the doc directly (same S3 key SvgService.getCanvas uses — duplicated here rather than routed
        // through a SvgService instance, since SvgService is bound to a full MediaService this pipeline
        // doesn't have) + resolve the requested pages (null pageIds = every page)
        const doc : Type.Result<SvgDocument.Doc> = await getCanvas( deps, accountId, projectId );
        if( !doc.ok ) { await setStatus( GetSvgRenderJob.RenderStatus.FAILED, null, "project doc not found" ); return; }
        const pages : Array<SvgDocument.Page> = pageIds === null
            ? doc.data.pages
            : doc.data.pages.filter( ( page : SvgDocument.Page ) : boolean => pageIds.includes( page.id ) );
        if( pages.length === 0 ) { await setStatus( GetSvgRenderJob.RenderStatus.FAILED, null, "no matching pages" ); return; }

        try
        {
            const rendered : { bytes : Buffer; ext : string; contentType : string } = await renderPages( browser, doc.data, pages, settings );
            const key : string = `svg-exports/${ accountId }/${ jobId }.${ rendered.ext }`;
            const uploaded : Type.Result<void> = await deps.s3.put( "media", key, rendered.bytes, rendered.contentType );
            if( !uploaded.ok ) { await setStatus( GetSvgRenderJob.RenderStatus.FAILED, null, "could not store the export" ); return; }
            const presigned : Type.Result<string> = await deps.s3.presignGet( "media", key, 3600 );
            if( !presigned.ok ) { await setStatus( GetSvgRenderJob.RenderStatus.FAILED, null, "could not presign the export" ); return; }
            await setStatus( GetSvgRenderJob.RenderStatus.DONE, presigned.data, null );
        }
        catch( err )
        {
            deps.log.warn( "svg render threw", { jobId, error: String( err ) } );
            await setStatus( GetSvgRenderJob.RenderStatus.FAILED, null, "render failed" );
        }
    }

    ///////////////////////////////////////////////////////////////////////////////////////
    /** Read a project's SvgDocument.Doc from S3 — the same key/shape as SvgService.getCanvas, duplicated
     *  here (a few lines) rather than threading an S3-only overload through SvgService for every caller. */
    async function getCanvas( deps : Deps, accountId : string, projectId : string ) : Promise<Type.Result<SvgDocument.Doc>>
    {
        const object : Type.Result<{ Body? : { transformToByteArray() : Promise<Uint8Array> } }> = await deps.s3.get( "media", SvgService.canvasKey( accountId, projectId ) );
        if( !object.ok || !object.data.Body ) return ResultUtils.err( "canvas not found" );
        const bytes : Uint8Array = await object.data.Body.transformToByteArray();
        const json : string = new TextDecoder().decode( bytes );
        return ResultUtils.attempt( () : SvgDocument.Doc => JSON.parse( json ) as SvgDocument.Doc );
    }

    ///////////////////////////////////////////////////////////////////////////////////////
    // ── Print-production markup (bleed / crop marks / registration marks / color bars) ────

    /** A page's full export markup + its canvas size in pt, dressed with whatever print-production furniture
     *  `settings` asks for. Uses `compilePageArtwork` (content only, no nested `<svg>`) rather than `compilePage`
     *  — nesting a whole second `<svg>` inside this canvas's `<g>` reproducibly makes Chromium's `page.pdf()`/
     *  screenshot rasterization silently drop any transformed content in the nested svg (see that function's
     *  doc comment); staying single-svg sidesteps it entirely. The compiler itself stays untouched — bleed/
     *  marks/bars are purely an export-time wrapper around its output. */
    function buildPageMarkup( doc : SvgDocument.Doc, page : SvgDocument.Page, settings : SvgDocument.ExportSettings ) : { svg : string; width : number; height : number }
    {
        const bleedPt : number = settings.includeBleed ? page.bleed : 0;
        const hasMarks : boolean = settings.includeCropMarks || settings.includeRegistrationMarks || settings.includeColorBars;
        const marginPt : number = hasMarks ? MARK_MARGIN_PT : 0;

        const trimW : number = page.size.width;
        const trimH : number = page.size.height;
        const bleedW : number = trimW + 2 * bleedPt;
        const bleedH : number = trimH + 2 * bleedPt;
        const canvasW : number = bleedW + 2 * marginPt;
        const canvasH : number = bleedH + 2 * marginPt;
        const originX : number = marginPt + bleedPt;   // where the doc's own (0,0) trim origin lands in canvas space
        const originY : number = marginPt + bleedPt;

        // extend the page's own solid background color through the bleed (an image/none background doesn't
        // get one — that's the same "you must design the bleed yourself" behavior any print tool has)
        const bleedBackground : string = settings.includeBleed && page.background.kind === "color" && page.background.color !== null
            ? `<rect x="${ marginPt }" y="${ marginPt }" width="${ bleedW }" height="${ bleedH }" fill="${ page.background.color }" />`
            : "";

        const artwork : string = `<g transform="translate(${ originX } ${ originY })">${ compilePageArtwork( doc, page ) }</g>`;

        const marks : Array<string> = [];
        if( settings.includeCropMarks )         marks.push( cropMarksSvg( marginPt, bleedW, bleedH ) );
        if( settings.includeRegistrationMarks )  marks.push( registrationMarksSvg( marginPt, bleedW, bleedH ) );
        if( settings.includeColorBars )          marks.push( colorBarSvg( marginPt, bleedW, bleedH ) );

        const svg : string = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${ canvasW } ${ canvasH }" width="${ canvasW }pt" height="${ canvasH }pt">${ bleedBackground }${ artwork }${ marks.join( "" ) }</svg>`;
        return { svg, width: canvasW, height: canvasH };
    }

    /** 2 short line segments per corner of the bleed box (horizontal + vertical), starting a small gap
     *  outside it and extending further out — the standard printer crop-mark convention (equals the trim
     *  corner when bleed is 0). */
    function cropMarksSvg( marginPt : number, bleedW : number, bleedH : number ) : string
    {
        const left : number = marginPt, top : number = marginPt, right : number = marginPt + bleedW, bottom : number = marginPt + bleedH;
        const corners : Array<{ x : number; y : number; dx : number; dy : number }> =
        [
            { x: left,  y: top,    dx: -1, dy: -1 },
            { x: right, y: top,    dx:  1, dy: -1 },
            { x: left,  y: bottom, dx: -1, dy:  1 },
            { x: right, y: bottom, dx:  1, dy:  1 },
        ];
        const lines : Array<string> = [];
        for( const corner of corners )
        {
            lines.push( `<line x1="${ corner.x + corner.dx * MARK_GAP_PT }" y1="${ corner.y }" x2="${ corner.x + corner.dx * ( MARK_GAP_PT + MARK_LENGTH_PT ) }" y2="${ corner.y }" stroke="#000000" stroke-width="0.5" />` );
            lines.push( `<line x1="${ corner.x }" y1="${ corner.y + corner.dy * MARK_GAP_PT }" x2="${ corner.x }" y2="${ corner.y + corner.dy * ( MARK_GAP_PT + MARK_LENGTH_PT ) }" stroke="#000000" stroke-width="0.5" />` );
        }
        return lines.join( "" );
    }

    /** A crosshair-in-circle registration target, centered at (cx,cy). */
    function registrationMarkGlyph( cx : number, cy : number ) : string
    {
        const r : number = REG_MARK_RADIUS_PT;
        return `<g stroke="#000000" stroke-width="0.5" fill="none"><circle cx="${ cx }" cy="${ cy }" r="${ r }" /><line x1="${ cx - r }" y1="${ cy }" x2="${ cx + r }" y2="${ cy }" /><line x1="${ cx }" y1="${ cy - r }" x2="${ cx }" y2="${ cy + r }" /></g>`;
    }

    /** A registration target at the midpoint of each of the 4 bleed-box edges, out in the reserved margin. */
    function registrationMarksSvg( marginPt : number, bleedW : number, bleedH : number ) : string
    {
        const midX : number = marginPt + bleedW / 2;
        const midY : number = marginPt + bleedH / 2;
        const topY : number = marginPt / 2;
        const bottomY : number = marginPt + bleedH + marginPt / 2;
        const leftX : number = marginPt / 2;
        const rightX : number = marginPt + bleedW + marginPt / 2;
        return [
            registrationMarkGlyph( midX, topY ),
            registrationMarkGlyph( midX, bottomY ),
            registrationMarkGlyph( leftX, midY ),
            registrationMarkGlyph( rightX, midY ),
        ].join( "" );
    }

    /** A row of C/M/Y/K + grayscale-ramp swatches centered along the bottom margin, outside the bleed box. */
    function colorBarSvg( marginPt : number, bleedW : number, bleedH : number ) : string
    {
        const swatches : Array<string> = [ "#00ffff", "#ff00ff", "#ffff00", "#000000", "#808080", "#c0c0c0", "#ffffff" ];
        const barWidth : number = Math.min( bleedW, swatches.length * 20 );
        const swatchWidth : number = barWidth / swatches.length;
        const startX : number = marginPt + ( bleedW - barWidth ) / 2;
        const y : number = marginPt + bleedH + ( marginPt - COLOR_BAR_HEIGHT_PT ) / 2;
        return swatches
            .map( ( color : string, index : number ) : string => `<rect x="${ startX + index * swatchWidth }" y="${ y }" width="${ swatchWidth }" height="${ COLOR_BAR_HEIGHT_PT }" fill="${ color }" stroke="#000000" stroke-width="0.25" />` )
            .join( "" );
    }

    /** A `<link>` tag requesting exactly the Google Fonts the requested pages actually use — the export
     *  pipeline runs in a fresh Puppeteer page with none of the editor canvas's globally-preloaded fonts (see
     *  `collectFontFamilies`'s doc comment), so without this every custom text font falls back to the
     *  browser's default serif. Empty string if the pages reference no fonts at all. */
    function googleFontsLinkTag( pages : Array<SvgDocument.Page> ) : string
    {
        const families : Array<string> = collectFontFamilies( pages );
        if( families.length === 0 ) return "";
        const query : string = families
            .map( ( family : string ) : string => `family=${ encodeURIComponent( family ) }` )
            .join( "&" );
        return `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?${ query }&display=swap" />`;
    }

    /** Runs INSIDE the Puppeteer page, not this Node process — page.evaluate() serializes this function and
     *  executes it in the browser, so it must be fully self-contained (only browser globals, nothing from the
     *  surrounding closure). Finds every `<text data-wrap="...">` placeholder `compileText` emitted (see that
     *  function's doc comment) and rewraps it for real using Chromium's own canvas.measureText — mirroring
     *  compileText/compileTextLine's layout math exactly, but with accurate glyph metrics (and the actual
     *  loaded font — this must run AFTER the fonts-ready wait) instead of a server-side guess. */
    function rewrapPlaceholderText() : void
    {
        interface WrapPayload
        {
            text     : string;
            boxWidth : number;
            fontSize : number;
            lineHeight : number;
            align    : "left" | "center" | "right" | "justify";
            textX    : number;
            tspanX   : number;
            style    : { fontFamily : string; fontWeight : number; fontStyle? : string; color : string; letterSpacing? : number; textDecoration? : string } | null;
        }

        const SVG_NS : string = "http://www.w3.org/2000/svg";
        const canvas : HTMLCanvasElement = document.createElement( "canvas" );
        const ctx : CanvasRenderingContext2D | null = canvas.getContext( "2d" );
        if( ctx === null ) return;

        const placeholders : NodeListOf<Element> = document.querySelectorAll( "text[data-wrap]" );
        placeholders.forEach( ( element : Element ) : void =>
        {
            const raw : string | null = element.getAttribute( "data-wrap" );
            if( raw === null ) return;
            const payload : WrapPayload = JSON.parse( decodeURIComponent( raw ) ) as WrapPayload;

            const spec : string = payload.style !== null
                ? `${ payload.style.fontStyle ?? "normal" } ${ payload.style.fontWeight } ${ payload.fontSize }px "${ payload.style.fontFamily }"`
                : `normal 400 ${ payload.fontSize }px sans-serif`;
            ctx.font = spec;

            // word-wrap each logical (pre-existing-newline) line to fit the box width — same algorithm as
            // SvgCompiler.ts's wrapLine, now with a real measurement since Chromium has the font loaded.
            // A small safety margin shrinks the effective width: this measures in the EXPORT pipeline's own
            // Chromium build, which can differ by a fraction of a percent from whatever arbitrary browser the
            // user's editor session runs in (font hinting/shaping rounds slightly differently per engine —
            // most noticeable on small fine-print sizes, where a fitting decision often comes down to under a
            // point of slack). Reserving a little headroom biases a near-exact-fit word toward wrapping —
            // matching or exceeding the editor's line count — rather than risking a line that fit here but
            // would have overflowed in the browser the document was actually designed in.
            const WRAP_SAFETY_MARGIN : number = 0.97;
            const effectiveBoxWidth  : number = payload.boxWidth * WRAP_SAFETY_MARGIN;
            const logicalLines : Array<string> = payload.text.split( "\n" );
            const visualLines  : Array<string> = [];
            for( const line of logicalLines )
            {
                if( line.trim() === "" ) { visualLines.push( "" ); continue; }
                const words : Array<string> = line.split( " " );
                let current : string = "";
                for( const word of words )
                {
                    const candidate : string = current.length === 0 ? word : `${ current } ${ word }`;
                    const width     : number = ctx.measureText( candidate ).width;
                    if( width > effectiveBoxWidth && current.length > 0 )
                    {
                        visualLines.push( current );
                        current = word;
                    }
                    else
                    {
                        current = candidate;
                    }
                }
                if( current.length > 0 ) visualLines.push( current );
            }
            const lineCount : number = visualLines.length;

            // rebuild the <tspan> children exactly as SvgCompiler.ts's compileTextLine does
            while( element.firstChild !== null ) element.removeChild( element.firstChild );
            visualLines.forEach( ( line : string, index : number ) : void =>
            {
                const tspan : Element = document.createElementNS( SVG_NS, "tspan" );
                tspan.setAttribute( "x", String( payload.align === "justify" ? 0 : payload.tspanX ) );
                tspan.setAttribute( "dy", String( index === 0 ? 0 : payload.lineHeight ) );
                if( payload.style !== null )
                {
                    tspan.setAttribute( "font-family", payload.style.fontFamily );
                    tspan.setAttribute( "font-weight", String( payload.style.fontWeight ) );
                    tspan.setAttribute( "font-style", payload.style.fontStyle ?? "normal" );
                    tspan.setAttribute( "font-size", String( payload.fontSize ) );
                    tspan.setAttribute( "fill", payload.style.color );
                    if( ( payload.style.letterSpacing ?? 0 ) !== 0 ) tspan.setAttribute( "letter-spacing", String( payload.style.letterSpacing ) );
                    if( payload.style.textDecoration !== undefined && payload.style.textDecoration !== "none" ) tspan.setAttribute( "text-decoration", payload.style.textDecoration );
                }
                else
                {
                    tspan.setAttribute( "font-size", String( payload.fontSize ) );
                }
                if( payload.align === "justify" && index < lineCount - 1 )
                {
                    tspan.setAttribute( "textLength", String( payload.boxWidth ) );
                    tspan.setAttribute( "lengthAdjust", "spacing" );
                }
                tspan.textContent = line.length > 0 ? line : " ";
                element.appendChild( tspan );
            } );
            element.removeAttribute( "data-wrap" );
        } );
    }

    /** Wait for the requested pages' fonts to finish loading, then resolve every `data-wrap` placeholder text
     *  node for real inside Chromium — the two steps every render path needs after `setContent()` and before
     *  reading back its result (a capture, or the markup itself for the plain-SVG format). */
    async function finishLoadingText( chromiumPage : ChromiumPage ) : Promise<void>
    {
        await chromiumPage.evaluate( () : Promise<unknown> => ( document as unknown as { fonts : { ready : Promise<unknown> } } ).fonts.ready );
        await chromiumPage.evaluate( rewrapPlaceholderText );
    }

    ///////////////////////////////////////////////////////////////////////////////////////
    // ── Format rendering ─────────────────────────────────────────────────────────────────

    /** Render the requested pages to the settings' target format — dispatches to the SVG/PDF/raster path. */
    async function renderPages( browser : Browser, doc : SvgDocument.Doc, pages : Array<SvgDocument.Page>, settings : SvgDocument.ExportSettings ) : Promise<{ bytes : Buffer; ext : string; contentType : string }>
    {
        if( settings.format === SvgDocument.ExportFormat.SVG ) return renderSvg( browser, doc, pages, settings );
        if( settings.format === SvgDocument.ExportFormat.PDF ) return renderPdf( browser, doc, pages, settings );
        return renderRaster( browser, doc, pages, settings );
    }

    /** Resolve one page's markup into its final, self-contained form — loads it into a scratch Chromium page
     *  just far enough to let `finishLoadingText` rewrap its `data-wrap` placeholders for real, then reads the
     *  resolved `<svg>` back out as a string. Needed only by `renderSvg`: PDF/raster already load the markup
     *  into a page for capture and can call `finishLoadingText` on that same page directly, but the plain-SVG
     *  format's deliverable IS the markup string, with no other Chromium step to piggyback on. */
    async function resolveSvgMarkup( browser : Browser, markup : string, fontsLink : string ) : Promise<string>
    {
        const chromiumPage : ChromiumPage = await browser.newPage();
        try
        {
            const html : string = `<!DOCTYPE html><html><head>${ fontsLink }</head><body>${ markup }</body></html>`;
            await chromiumPage.setContent( html, { waitUntil: "load" } );
            await finishLoadingText( chromiumPage );
            const resolved : string = await chromiumPage.evaluate( () : string => document.querySelector( "svg" )?.outerHTML ?? "" );
            return resolved;
        }
        finally
        {
            await chromiumPage.close();
        }
    }

    /** SVG export needs no Chromium for the print-production wrapping itself — it's already the compiler's
     *  (+ print-furniture wrapper's) native output — but DOES need a scratch Chromium page to resolve any
     *  `data-wrap` text placeholders for real (see `resolveSvgMarkup`). A single requested page uploads as one
     *  .svg file; multiple pages are zipped (same convention as multi-page raster). */
    async function renderSvg( browser : Browser, doc : SvgDocument.Doc, pages : Array<SvgDocument.Page>, settings : SvgDocument.ExportSettings ) : Promise<{ bytes : Buffer; ext : string; contentType : string }>
    {
        const fontsLink : string = googleFontsLinkTag( pages );
        if( pages.length === 1 )
        {
            const resolved : string = await resolveSvgMarkup( browser, buildPageMarkup( doc, pages[ 0 ], settings ).svg, fontsLink );
            return { bytes: Buffer.from( resolved, "utf8" ), ext: "svg", contentType: FileUtils.Mime.IMAGE_SVG };
        }
        const files : Array<{ name : string; bytes : Buffer }> = [];
        for( let index : number = 0; index < pages.length; index++ )
        {
            const resolved : string = await resolveSvgMarkup( browser, buildPageMarkup( doc, pages[ index ], settings ).svg, fontsLink );
            files.push( { name: `page-${ index + 1 }.svg`, bytes: Buffer.from( resolved, "utf8" ) } );
        }
        const zipped : Buffer = await zipFiles( files );
        return { bytes: zipped, ext: "zip", contentType: FileUtils.Mime.ZIP };
    }

    /** PDF export — one Chromium document with a `.page` div per requested page (page-break-after between
     *  them), rendered to a single multi-page PDF sized to the first page's pt→px dimensions (including any
     *  bleed/mark margin) at the target DPI. `colorSpace: "cmyk"` is a documented no-op here — rasterizing an
     *  otherwise-vector PDF to run a per-pixel CMYK-look filter is a much bigger fidelity trade-off than the
     *  raster case below, so real CMYK stays raster-only for now (see `renderRaster`).
     *  (MVP scope: every requested page shares the first page's physical size — a document mixing very
     *  different page sizes in one export will letterbox/clip the mismatched pages rather than resizing the
     *  physical paper per page, which Chromium's print pipeline doesn't support per-page.) */
    async function renderPdf( browser : Browser, doc : SvgDocument.Doc, pages : Array<SvgDocument.Page>, settings : SvgDocument.ExportSettings ) : Promise<{ bytes : Buffer; ext : string; contentType : string }>
    {
        const pxPerPt : number = settings.dpi / 72;
        const markups : Array<{ svg : string; width : number; height : number }> = pages.map( ( page : SvgDocument.Page ) : { svg : string; width : number; height : number } => buildPageMarkup( doc, page, settings ) );
        const pageWidthPx : number = Math.round( markups[ 0 ].width * pxPerPt );
        const pageHeightPx : number = Math.round( markups[ 0 ].height * pxPerPt );
        const sections : string = markups
            .map( ( markup : { svg : string; width : number; height : number } ) : string =>
            {
                const width : number = Math.round( markup.width * pxPerPt );
                const height : number = Math.round( markup.height * pxPerPt );
                return `<div style="width:${ width }px;height:${ height }px;overflow:hidden;page-break-after:always;"><div style="width:100%;height:100%">${ markup.svg }</div></div>`;
            } )
            .join( "" );
        const html : string = `<!DOCTYPE html><html><head>${ googleFontsLinkTag( pages ) }<style>*{margin:0;padding:0;}div>svg{display:block;width:100%;height:100%;}</style></head><body>${ sections }</body></html>`;

        const chromiumPage : ChromiumPage = await browser.newPage();
        try
        {
            await chromiumPage.setContent( html, { waitUntil: "load" } );
            // the Google Fonts stylesheet above loads asynchronously — "load" only waits for the <link> request
            // itself, not for the referenced @font-face glyphs to finish downloading — and any text that
            // couldn't be measured server-side needs the loaded font to wrap for real (see finishLoadingText)
            await finishLoadingText( chromiumPage );
            const pdf : Uint8Array = await chromiumPage.pdf( { width: `${ pageWidthPx }px`, height: `${ pageHeightPx }px`, printBackground: true } );
            return { bytes: Buffer.from( pdf ), ext: "pdf", contentType: FileUtils.Mime.PDF };
        }
        finally
        {
            await chromiumPage.close();
        }
    }

    /** Raster (PNG/JPEG) export — one screenshot per requested page at the target DPI (viewport sized to the
     *  page's pt→px dimensions, including any bleed/mark margin). A single page uploads as one image;
     *  multiple pages are zipped together. `colorSpace: "cmyk"` runs a naive per-pixel RGB→CMY/K
     *  approximation over the rendered bytes afterward — a visual preview, NOT a color-managed conversion
     *  (no ICC profile, doesn't touch the actual color space of anything downstream). */
    async function renderRaster( browser : Browser, doc : SvgDocument.Doc, pages : Array<SvgDocument.Page>, settings : SvgDocument.ExportSettings ) : Promise<{ bytes : Buffer; ext : string; contentType : string }>
    {
        const pxPerPt : number = settings.dpi / 72;
        const type : "png" | "jpeg" = settings.format === SvgDocument.ExportFormat.JPEG ? "jpeg" : "png";
        const ext : string = type === "jpeg" ? "jpg" : "png";
        const images : Array<{ name : string; bytes : Buffer }> = [];
        const fontsLink : string = googleFontsLinkTag( pages );

        const chromiumPage : ChromiumPage = await browser.newPage();
        try
        {
            // reuse one Chromium tab across pages — a fresh viewport + content load per page keeps memory bounded
            for( let index : number = 0; index < pages.length; index++ )
            {
                const page : SvgDocument.Page = pages[ index ];
                const markup : { svg : string; width : number; height : number } = buildPageMarkup( doc, page, settings );
                const width : number = Math.round( markup.width * pxPerPt );
                const height : number = Math.round( markup.height * pxPerPt );
                const html : string = `<!DOCTYPE html><html><head>${ fontsLink }<style>*{margin:0;padding:0;}html,body{width:${ width }px;height:${ height }px;}body>svg{display:block;width:${ width }px;height:${ height }px;}</style></head><body>${ markup.svg }</body></html>`;
                await chromiumPage.setViewport( { width, height, deviceScaleFactor: 1 } );
                await chromiumPage.setContent( html, { waitUntil: "load" } );
                // wait for fonts + rewrap any data-wrap placeholders for real before capturing this page (see
                // finishLoadingText's/renderPdf's identical step for why "load" alone isn't enough)
                await finishLoadingText( chromiumPage );
                const shot : Uint8Array = type === "jpeg"
                    ? await chromiumPage.screenshot( { type: "jpeg", quality: 92 } )
                    : await chromiumPage.screenshot( { type: "png" } );
                const bytes : Buffer = settings.colorSpace === "cmyk" ? await applyCmykLook( Buffer.from( shot ), type ) : Buffer.from( shot );
                images.push( { name: `page-${ index + 1 }.${ ext }`, bytes } );
            }
        }
        finally
        {
            await chromiumPage.close();
        }

        if( images.length === 1 )
            return { bytes: images[ 0 ].bytes, ext, contentType: type === "jpeg" ? FileUtils.Mime.IMAGE_JPEG : FileUtils.Mime.IMAGE_PNG };

        const zipped : Buffer = await zipFiles( images );
        return { bytes: zipped, ext: "zip", contentType: FileUtils.Mime.ZIP };
    }

    /** Load sharp, tolerating CJS/ESM interop under tsx/esbuild (same pattern as MediaAnalyzer.loadSharp). */
    async function loadSharp() : Promise<typeof import( "sharp" )>
    {
        const mod = await import( "sharp" );
        return ( ( mod as { default? : unknown } ).default ?? mod ) as typeof import( "sharp" );
    }

    // NOTE: a "standard" C/M/Y/K extraction (K = 1 - max(r,g,b), then C/M/Y from the remainder) is USELESS
    // as an approximation on its own — recombining it back to RGB is an exact mathematical inverse (a lossless
    // round trip), so it renders identically to "rgb" no matter what. It also always drives whichever of C/M/Y
    // corresponds to the max(r,g,b) channel to exactly 0, so there's no shared "gray" component left to move
    // into K either (a gray-component-replacement pass on top of it is a no-op for the same reason). Real
    // CMYK's visual difference from screen RGB comes from its smaller color gamut + dot gain, not from the
    // C/M/Y/K split itself — so this approximates THAT instead: a flat desaturate-and-darken blend.
    const CMYK_DESATURATE : number = 0.25;   // blend this much of each pixel toward its own luma (smaller gamut)
    const CMYK_DARKEN     : number = 0.92;   // flat multiplier (CMYK print commonly reads darker than the screen render)

    /** A naive, uncalibrated RGB→CMYK "look" — NOT a color-managed conversion (no ICC profile, no actual
     *  DeviceCMYK color space; the output is still an sRGB PNG/JPEG). Blends each pixel partway toward its
     *  own luma (desaturate, simulating CMYK's smaller gamut) and darkens slightly (simulating dot gain) — a
     *  crude visual preview, not a color-managed conversion. Documented approximation, per this repo's
     *  convention of calling out preview-only fidelity trade-offs rather than silently pretending they're exact. */
    async function applyCmykLook( bytes : Buffer, type : "png" | "jpeg" ) : Promise<Buffer>
    {
        const sharp = await loadSharp();
        const { data, info } = await sharp( bytes ).ensureAlpha().raw().toBuffer( { resolveWithObject: true } );
        const raw : Buffer = Buffer.from( data );
        for( let index : number = 0; index < raw.length; index += 4 )
        {
            const r : number = raw[ index ], g : number = raw[ index + 1 ], b : number = raw[ index + 2 ];
            const luma : number = 0.299 * r + 0.587 * g + 0.114 * b;
            raw[ index ]     = Math.round( ( r + ( luma - r ) * CMYK_DESATURATE ) * CMYK_DARKEN );
            raw[ index + 1 ] = Math.round( ( g + ( luma - g ) * CMYK_DESATURATE ) * CMYK_DARKEN );
            raw[ index + 2 ] = Math.round( ( b + ( luma - b ) * CMYK_DESATURATE ) * CMYK_DARKEN );
        }
        const output = sharp( raw, { raw: { width: info.width, height: info.height, channels: 4 } } );
        return type === "jpeg" ? output.jpeg( { quality: 92 } ).toBuffer() : output.png().toBuffer();
    }

    /** Zip a set of in-memory files (same streaming-zip idiom as MediaService's archive job: dynamic-import
     *  `archiver` — CJS/ESM interop under tsx/esbuild — collect its "data" chunks, finalize, concat). */
    async function zipFiles( files : Array<{ name : string; bytes : Buffer }> ) : Promise<Buffer>
    {
        const archiverModule = await import( "archiver" );
        const makeArchive = ( ( archiverModule as { default? : unknown } ).default ?? archiverModule ) as ( format : string, options? : object ) => import( "archiver" ).Archiver;
        const archive : import( "archiver" ).Archiver = makeArchive( "zip", { zlib: { level: 9 } } );
        const chunks : Array<Buffer> = [];
        archive.on( "data", ( chunk : Buffer ) => chunks.push( chunk ) );
        const finished : Promise<void> = new Promise<void>( ( resolve, reject ) => { archive.on( "end", () => resolve() ); archive.on( "error", ( err : Error ) => reject( err ) ); } );
        for( const file of files ) archive.append( file.bytes, { name: file.name } );
        await archive.finalize();
        await finished;
        return Buffer.concat( chunks );
    }
}

export default SvgRenderPipeline;
// eof
