//
import { SvgDocument } from "./SvgDocument";

//
// SvgCompiler — the pure (no React) compiler that turns a SvgDocument.Doc + one Page into a complete SVG
// string. This is the single rendering path: the canvas shows the compiled markup, and the export pipeline
// serializes the same output. Positions are in points and map 1:1 to the SVG user space (viewBox in pt).
// Lives alongside the SvgDocument model (not in the web app) so both the web editor AND the media service's
// export-render consumer (Puppeteer) import the exact same compilation logic — no parallel implementation.
//
// Layout: <svg viewBox> → <defs> (gradients) → <style> (@import font stylesheets) → background → layers →
// each object composed under its decomposed transform, tagged with data-id for click hit-testing.
//

/** Module-level canvas context reused across all text measurements to avoid per-call allocation.
 *  "uninitialized" means we haven't yet tried to create it; null means no canvas API available. */
let measureCtx : CanvasRenderingContext2D | null | "uninitialized" = "uninitialized";

/** Return (or lazily create) the shared off-screen canvas context used for glyph-width measurement. */
function getCanvasContext() : CanvasRenderingContext2D | null
{
    if( measureCtx !== "uninitialized" ) return measureCtx;
    if( typeof document === "undefined" ) { measureCtx = null; return null; }
    const canvas : HTMLCanvasElement = document.createElement( "canvas" );
    measureCtx = canvas.getContext( "2d" );
    return measureCtx;
}

/** Build the CSS font shorthand for a TextStyle (used to prime the canvas context before measuring). */
function fontSpec( style : SvgDocument.TextStyle ) : string
{
    return `${ style.fontStyle ?? "normal" } ${ style.fontWeight } ${ style.fontSize }px "${ String( style.fontFamily ) }"`;
}

/** Break a single logical line into visual lines that fit within maxWidth (in doc-space points), using canvas
 *  measureText for accurate glyph metrics (treating fontSize px ≈ fontSize pt for ratio comparisons, which is
 *  consistent because both the measured advance and the box width use the same numeric scale). Only ever
 *  called with a real ctx — compileText takes the `data-wrap` placeholder path instead when none is
 *  available, so this never needs a no-canvas fallback. */
function wrapLine( line : string, maxWidth : number, spec : string, ctx : CanvasRenderingContext2D ) : Array<string>
{
    if( line.trim() === "" ) return [ "" ];
    const words        : Array<string> = line.split( " " );
    const visualLines  : Array<string> = [];
    let current        : string = "";
    ctx.font = spec;
    for( const word of words )
    {
        const candidate : string = current.length === 0 ? word : `${ current } ${ word }`;
        const candidateWidth : number = ctx.measureText( candidate ).width;
        if( candidateWidth > maxWidth && current.length > 0 )
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
    return visualLines.length > 0 ? visualLines : [ "" ];
}

/** Escape the five XML-significant characters so user text is safe inside markup. */
function escapeXml( value : string ) : string
{
    return value
        .replace( /&/g, "&amp;" )
        .replace( /</g, "&lt;" )
        .replace( />/g, "&gt;" )
        .replace( /"/g, "&quot;" )
        .replace( /'/g, "&apos;" );
}

/** The gradient element id for a given object (deterministic so <defs> + fill refs match). */
function gradientId( objectId : string ) : string
{
    return `grad-${ objectId }`;
}

/** The clipPath element id for a cropped image node. */
function cropClipId( objectId : string ) : string
{
    return `crop-${ objectId }`;
}

/** Flatten every object in a page (recursing into groups) — used to gather gradient defs. */
function flattenObjects( objects : Array<SvgDocument.ObjectNode> ) : Array<SvgDocument.ObjectNode>
{
    const flat : Array<SvgDocument.ObjectNode> = [];
    for( const object of objects )
    {
        flat.push( object );
        if( object.kind === SvgDocument.ObjectKind.GROUP )
        {
            const nested : Array<SvgDocument.ObjectNode> = flattenObjects( object.objects );
            flat.push( ...nested );
        }
    }
    return flat;
}

/** Compose an object's decomposed transform into an SVG `transform` attribute value (translate/rotate/scale,
 *  with flips folded into the scale signs), rotating about the object's own centre. */
function transformValue( transform : SvgDocument.Transform ) : string
{
    const centreX : number = transform.width / 2;
    const centreY : number = transform.height / 2;
    const scaleX : number = transform.scaleX * ( transform.flipH ? -1 : 1 );
    const scaleY : number = transform.scaleY * ( transform.flipV ? -1 : 1 );
    // translate to position, rotate about the centre, then apply scale (with flip signs)
    return `translate(${ transform.x } ${ transform.y }) rotate(${ transform.rotation } ${ centreX } ${ centreY }) scale(${ scaleX } ${ scaleY })`;
}

/** The `fill` attribute value for a fill spec (a gradient refers to its <defs> entry by object id). */
function fillValue( fill : SvgDocument.Fill, objectId : string ) : string
{
    switch( fill.kind )
    {
        case SvgDocument.FillKind.SOLID    : return fill.color;
        case SvgDocument.FillKind.GRADIENT : return `url(#${ gradientId( objectId ) })`;
        case SvgDocument.FillKind.PATTERN  : return `url(#${ fill.pattern })`;
        case SvgDocument.FillKind.NONE     : return "none";
        default                            : return "none";
    }
}

/** Build the stroke presentation attributes for a stroke (empty string when there is no stroke). */
function strokeAttrs( stroke : SvgDocument.Stroke | null ) : string
{
    if( stroke === null ) return "";
    const dash : string = stroke.dash !== null ? ` stroke-dasharray="${ escapeXml( stroke.dash ) }"` : "";
    return ` stroke="${ stroke.color }" stroke-width="${ stroke.width }" stroke-linecap="${ stroke.lineCap }" stroke-linejoin="${ stroke.lineJoin }"${ dash }`;
}

/** Build a <linearGradient>/<radialGradient> def for a gradient fill. */
function gradientDef( objectId : string, gradient : SvgDocument.Gradient ) : string
{
    // each stop → an <stop> element (offset as a percentage, plus opacity)
    const stops : string = gradient.stops
        .map( ( stop : SvgDocument.GradientStop ) : string => `<stop offset="${ stop.offset * 100 }%" stop-color="${ stop.color }" stop-opacity="${ stop.opacity }" />` )
        .join( "" );
    if( gradient.type === SvgDocument.GradientType.RADIAL )
        return `<radialGradient id="${ gradientId( objectId ) }">${ stops }</radialGradient>`;
    // linear: express the angle via gradientTransform so the stops read left→right
    return `<linearGradient id="${ gradientId( objectId ) }" gradientTransform="rotate(${ gradient.angle })">${ stops }</linearGradient>`;
}

/** Resolve an image asset's URL (CDN link, else an embedded data URI, else empty). */
function assetUrl( doc : SvgDocument.Doc, assetId : string ) : string
{
    const asset : SvgDocument.Asset | undefined = doc.assets.find( ( candidate : SvgDocument.Asset ) : boolean => candidate.id === assetId );
    if( asset === undefined ) return "";
    return asset.cdnUrl ?? asset.embedded ?? "";
}

/** Compile one display line of a text node to a <tspan> with a resetting x attribute and dy line-spacing.
 *  dy=0 for the first line (it inherits the <text> element's y baseline); subsequent lines advance by lineHeight.
 *  Empty lines receive a non-breaking space so the dy offset still applies (plain spaces collapse in SVG).
 *  textLength, when non-null, stretches the line to exactly that width via SVG textLength/lengthAdjust for
 *  justified text (all non-last lines of a justified paragraph get textLength = the bounding-box width). */
// tspanX is pre-adjusted by compileText to compensate for SVG trailing letter-spacing on centered/right text
function compileTextLine( line : string, index : number, tspanX : number, lineHeight : number, fontSize : number, style : SvgDocument.TextStyle | undefined, textLength : number | null ) : string
{
    const dy             : number = index === 0 ? 0 : lineHeight;
    const safeText       : string = escapeXml( line.length > 0 ? line : " " );
    const letterSpacing  : string = style !== undefined && ( style.letterSpacing ?? 0 ) !== 0
        ? ` letter-spacing="${ style.letterSpacing }"`
        : "";
    const decoration     : string = style !== undefined && style.textDecoration !== undefined && style.textDecoration !== "none"
        ? ` text-decoration="${ style.textDecoration }"`
        : "";
    const textLengthAttr : string = textLength !== null ? ` textLength="${ textLength }" lengthAdjust="spacing"` : "";
    const styleAttrs     : string = style !== undefined
        ? `font-family="${ escapeXml( String( style.fontFamily ) )}" font-weight="${ style.fontWeight }" font-style="${ style.fontStyle ?? "normal" }" font-size="${ fontSize }" fill="${ style.color }"${ letterSpacing }${ decoration }`
        : `font-size="${ fontSize }"`;
    return `<tspan x="${ tspanX }" dy="${ dy }" ${ styleAttrs }${ textLengthAttr }>${ safeText }</tspan>`;
}

/** Compile a text object's inner markup.
 *  Joins all span text into a single string, splits on explicit newlines, then word-wraps each logical
 *  line to fit within the bounding-box width using canvas measureText for accurate glyph metrics.
 *  Justified text uses SVG textLength/lengthAdjust="spacing" on every non-last wrapped line.
 *  text-anchor + x live on the <text> element for alignment.
 *  When no canvas is available (server-side, i.e. the export pipeline running in Node before Puppeteer even
 *  launches) wrapping can't be measured accurately here at all — rather than guess with a heuristic that
 *  drifts from the editor's real measurement, this emits an unwrapped placeholder (`data-wrap`, carrying
 *  everything needed to redo this exact computation) for the export pipeline to re-wrap for real inside
 *  Chromium after page load, using the same canvas.measureText the editor uses — see
 *  `SvgRenderPipeline.rewrapPlaceholderText`. */
function compileText( node : SvgDocument.TextNode ) : string
{
    const firstStyle  : SvgDocument.TextStyle | undefined = node.content[ 0 ]?.style;
    const fontSize    : number = firstStyle?.fontSize ?? 16;
    const lineSpacing : number = firstStyle?.lineSpacing ?? 1.2;
    const lineHeight  : number = fontSize * lineSpacing;
    const align       : "left" | "center" | "right" | "justify" = firstStyle?.align ?? "left";
    const anchor      : string = anchorForAlign( align );
    const boxWidth    : number = node.transform.width;
    // x anchor: 0 = left/justify edge, half-width = centre, full-width = right edge
    const textX       : number = align === "center" ? boxWidth / 2 : align === "right" ? boxWidth : 0;
    // SVG letter-spacing adds a trailing space after the last glyph, biasing centered/right text off-centre;
    // shift each tspan's x by ls/2 (centre) or ls (right) so visual text stays at the declared anchor
    const ls          : number = firstStyle?.letterSpacing ?? 0;
    const lsComp      : number = align === "center" ? ls / 2 : align === "right" ? ls : 0;
    const tspanX      : number = textX + lsComp;
    // combine all spans then split on explicit newlines to get the logical (pre-wrap) lines
    const fullText : string = node.content
        .map( ( span : SvgDocument.TextSpan ) : string => span.text )
        .join( "" );
    const ctx : CanvasRenderingContext2D | null = getCanvasContext();
    if( ctx === null )
    {
        const payload : string = encodeURIComponent( JSON.stringify( { text: fullText, boxWidth, fontSize, lineHeight, align, textX, tspanX, style: firstStyle ?? null } ) );
        return `<text data-wrap="${ payload }" x="${ textX }" y="${ fontSize }" text-anchor="${ anchor }"></text>`;
    }
    const logicalLines : Array<string> = fullText.split( "\n" );
    // word-wrap each logical line to fit within the bounding box (canvas measureText, pt ≈ px for ratios)
    const spec         : string = firstStyle !== undefined ? fontSpec( firstStyle ) : `normal 400 ${ fontSize }px sans-serif`;
    const visualLines  : Array<string> = logicalLines.flatMap( ( line : string ) : Array<string> => wrapLine( line, boxWidth, spec, ctx ) );
    const lineCount    : number = visualLines.length;
    const tspans : string = visualLines
        .map( ( line : string, index : number ) : string =>
            compileTextLine(
                line, index,
                align === "justify" ? 0 : tspanX,
                lineHeight, fontSize, firstStyle,
                align === "justify" && index < lineCount - 1 ? boxWidth : null,
            )
        )
        .join( "" );
    return `<text x="${ textX }" y="${ fontSize }" text-anchor="${ anchor }">${ tspans }</text>`;
}

/** Map a text alignment to the SVG text-anchor value. */
function anchorForAlign( align : "left" | "center" | "right" | "justify" ) : string
{
    if( align === "center" ) return "middle";
    if( align === "right" )  return "end";
    return "start";
}

/** Compile a shape object's geometry element (rect/circle/ellipse/line/polygon/path…). */
function compileShape( node : SvgDocument.ShapeNode ) : string
{
    const width : number = node.transform.width;
    const height : number = node.transform.height;
    const fill : string = fillValue( node.fill, node.id );
    const stroke : string = strokeAttrs( node.stroke );
    const paint : string = `fill="${ fill }"${ stroke }`;

    switch( node.shapeType )
    {
        case SvgDocument.ShapeType.RECT :
            return `<rect x="0" y="0" width="${ width }" height="${ height }" rx="${ node.cornerRadius }" ${ paint } />`;
        case SvgDocument.ShapeType.CIRCLE :
            return `<circle cx="${ width / 2 }" cy="${ width / 2 }" r="${ width / 2 }" ${ paint } />`;
        case SvgDocument.ShapeType.ELLIPSE :
            return `<ellipse cx="${ width / 2 }" cy="${ height / 2 }" rx="${ width / 2 }" ry="${ height / 2 }" ${ paint } />`;
        case SvgDocument.ShapeType.LINE :
            return `<line x1="0" y1="0" x2="${ width }" y2="${ height }" ${ paint } />`;
        case SvgDocument.ShapeType.POLYGON :
        case SvgDocument.ShapeType.STAR :
            return `<polygon points="${ polygonPoints( node ) }" ${ paint } />`;
        case SvgDocument.ShapeType.PATH :
        case SvgDocument.ShapeType.ARROW :
        case SvgDocument.ShapeType.CUSTOM :
        {
            const pathD : string = escapeXml( node.pathData ?? "" );
            // prepend an invisible wide-stroke duplicate path as a click-hit area so thin lines and dotted
            // paths remain selectable even when fill is none or the visible stroke is very narrow
            const hitStrokeW : number = Math.max( ( node.stroke?.width ?? 1 ) + 10, 12 );
            const hitPath : string = `<path d="${ pathD }" fill="none" stroke="transparent" stroke-width="${ hitStrokeW }" />`;
            return `${ hitPath }<path d="${ pathD }" ${ paint } />`;
        }
        default :
            return `<rect x="0" y="0" width="${ width }" height="${ height }" ${ paint } />`;
    }
}

/** Compute the `points` for a regular polygon / star inscribed in the object's box. */
function polygonPoints( node : SvgDocument.ShapeNode ) : string
{
    const centreX : number = node.transform.width / 2;
    const centreY : number = node.transform.height / 2;
    const radius : number = Math.min( centreX, centreY );
    const sides : number = Math.max( 3, node.sides );
    const isStar : boolean = node.shapeType === SvgDocument.ShapeType.STAR;
    const points : Array<string> = [];
    // walk the vertices around the centre; a star alternates outer/inner radius
    const steps : number = isStar ? sides * 2 : sides;
    for( let index : number = 0; index < steps; index++ )
    {
        const useInner : boolean = isStar && index % 2 === 1;
        const reach : number = useInner ? radius * Math.max( 0.1, node.innerRadius || 0.5 ) : radius;
        const angle : number = ( Math.PI * 2 * index ) / steps - Math.PI / 2;
        const pointX : number = centreX + reach * Math.cos( angle );
        const pointY : number = centreY + reach * Math.sin( angle );
        points.push( `${ pointX },${ pointY }` );
    }
    return points.join( " " );
}

/** Compile an image object. A raster (or CDN-linked) asset renders as an <image href> element. An
 *  AssetKind.SVG asset instead inlines its own (already-sanitized) markup natively — a nested, viewBox-mapped
 *  <svg> — so it scales losslessly through export at any DPI instead of being an opaque raster-like embed.
 *  When a crop is set, the content renders at its full node size and a <clipPath> masks out the region
 *  outside the crop rect — it is NOT rescaled, only the visible window changes. */
function compileImage( doc : SvgDocument.Doc, node : SvgDocument.ImageNode ) : string
{
    const nodeWidth  : number = node.transform.width;
    const nodeHeight : number = node.transform.height;
    const asset      : SvgDocument.Asset | undefined = doc.assets.find( ( candidate : SvgDocument.Asset ) : boolean => candidate.id === node.assetId );

    const content : string = asset !== undefined && asset.kind === SvgDocument.AssetKind.SVG && asset.embedded !== null
        ? inlineSvgMarkup( asset.embedded, nodeWidth, nodeHeight )
        : `<image href="${ escapeXml( assetUrl( doc, node.assetId ) ) }" x="0" y="0" width="${ nodeWidth }" height="${ nodeHeight }" preserveAspectRatio="xMidYMid slice" />`;

    if( node.crop === null )
        return content;
    return `<g clip-path="url(#${ cropClipId( node.id ) })">${ content }</g>`;
}

/** Inline an SVG asset's own (already-sanitized) markup as a nested <svg>, mapped into the node's box via
 *  its ORIGINAL viewBox/size — the same mechanism a nested <svg> element always uses to scale its content,
 *  just applied to a whole re-hosted fragment instead of hand-authored shapes. Falls back to treating the
 *  source as already sized to `width`×`height` (no scaling) when neither a viewBox nor width/height can be
 *  read off its outer <svg> tag. */
function inlineSvgMarkup( markup : string, width : number, height : number ) : string
{
    const openTagMatch : RegExpMatchArray | null = markup.match( /<svg\b([^>]*)>/i );
    if( openTagMatch === null ) return "";   // not a valid SVG fragment — render nothing rather than break the page

    const attrs        : string = openTagMatch[ 1 ];
    const viewBoxMatch : RegExpMatchArray | null = attrs.match( /viewBox\s*=\s*["']([^"']+)["']/i );
    const widthMatch   : RegExpMatchArray | null = attrs.match( /(?<!view)width\s*=\s*["']([\d.]+)/i );
    const heightMatch  : RegExpMatchArray | null = attrs.match( /(?<!view)height\s*=\s*["']([\d.]+)/i );
    const viewBox      : string = viewBoxMatch !== null ? viewBoxMatch[ 1 ]
        : `0 0 ${ widthMatch !== null ? widthMatch[ 1 ] : width } ${ heightMatch !== null ? heightMatch[ 1 ] : height }`;

    // the inner content between the (possibly self-closing) opening tag and the closing tag
    const innerStart : number = ( openTagMatch.index ?? 0 ) + openTagMatch[ 0 ].length;
    const closeIndex : number = markup.lastIndexOf( "</svg>" );
    const inner       : string = closeIndex > innerStart ? markup.slice( innerStart, closeIndex ) : "";

    return `<svg x="0" y="0" width="${ width }" height="${ height }" viewBox="${ viewBox }" preserveAspectRatio="xMidYMid meet">${ inner }</svg>`;
}

/** Compile a single object (any kind) into its transform group, tagged with its data-id for hit-testing. */
// excludeNodeId: when set, that node is omitted from the output so an inline textarea can overlay it
function compileObject( doc : SvgDocument.Doc, node : SvgDocument.ObjectNode, excludeNodeId : string | null ) : string
{
    if( node.hidden || node.id === excludeNodeId ) return "";
    const inner : string = compileObjectInner( doc, node );
    const transform : string = transformValue( node.transform );
    return `<g data-id="${ node.id }" transform="${ transform }" opacity="${ node.opacity }">${ inner }</g>`;
}

/** Compile the inner geometry/content of an object (dispatch on kind). */
function compileObjectInner( doc : SvgDocument.Doc, node : SvgDocument.ObjectNode ) : string
{
    switch( node.kind )
    {
        case SvgDocument.ObjectKind.TEXT      : return compileText( node );
        case SvgDocument.ObjectKind.SHAPE     : return compileShape( node );
        case SvgDocument.ObjectKind.IMAGE     : return compileImage( doc, node );
        case SvgDocument.ObjectKind.GROUP     : return compileGroup( doc, node );
        case SvgDocument.ObjectKind.GENERATED : return node.cachedSvg ?? "";
        case SvgDocument.ObjectKind.COMPONENT : return "";   // resolved from the StyleLibrary in a later phase
        default                               : return "";
    }
}

/** Compile a group by wrapping its children's compilations in a <g>. */
function compileGroup( doc : SvgDocument.Doc, node : SvgDocument.GroupNode ) : string
{
    return node.objects
        .map( ( child : SvgDocument.ObjectNode ) : string => compileObject( doc, child, null ) )
        .join( "" );
}

/** Compile one layer's visible objects (a hidden/lockless layer still paints; hidden layers are skipped). */
function compileLayer( doc : SvgDocument.Doc, layer : SvgDocument.Layer, excludeNodeId : string | null ) : string
{
    if( layer.hidden ) return "";
    const objects : string = layer.objects
        .map( ( object : SvgDocument.ObjectNode ) : string => compileObject( doc, object, excludeNodeId ) )
        .join( "" );
    return `<g data-layer="${ layer.id }" opacity="${ layer.opacity }">${ objects }</g>`;
}

/** Distinct font-family names referenced by any text object across the given pages. The editor canvas
 *  preloads a fixed, curated Google Fonts stylesheet globally into the browser (see `GOOGLE_FONTS_TOP_50` in
 *  the web app), so any of those families "just works" there regardless of `doc.assets` — but a fresh
 *  Puppeteer page in the export pipeline has no such global stylesheet, and `fontStyle()` below only covers
 *  `FONT_CDN` doc assets (rare in practice). The export pipeline uses this to request exactly the fonts the
 *  document actually needs from Google Fonts directly, so custom fonts don't silently fall back to a
 *  browser-default serif in the rendered PDF/PNG. */
export function collectFontFamilies( pages : Array<SvgDocument.Page> ) : Array<string>
{
    const families : Set<string> = new Set<string>();
    for( const page of pages )
    {
        const objects : Array<SvgDocument.ObjectNode> = flattenObjects( page.layers.flatMap( ( layer : SvgDocument.Layer ) : Array<SvgDocument.ObjectNode> => layer.objects ) );
        for( const object of objects )
        {
            if( object.kind !== SvgDocument.ObjectKind.TEXT ) continue;
            for( const span of object.content )
                if( span.style?.fontFamily ) families.add( String( span.style.fontFamily ) );
        }
    }
    return [ ...families ];
}

/** Build the <style> block that @imports each FONT_CDN asset's stylesheet (so fonts render on canvas). */
function fontStyle( doc : SvgDocument.Doc ) : string
{
    const imports : string = doc.assets
        .filter( ( asset : SvgDocument.Asset ) : boolean => asset.kind === SvgDocument.AssetKind.FONT_CDN && asset.cdnUrl !== null )
        .map( ( asset : SvgDocument.Asset ) : string => `@import url('${ asset.cdnUrl }');` )
        .join( "" );
    if( imports === "" ) return "";
    return `<style>${ imports }</style>`;
}

/** Build the <defs> block (gradient defs for gradient-filled shapes + clipPath defs for cropped images). */
function pageDefs( page : SvgDocument.Page ) : string
{
    const objects : Array<SvgDocument.ObjectNode> = flattenObjects( page.layers.flatMap( ( layer : SvgDocument.Layer ) : Array<SvgDocument.ObjectNode> => layer.objects ) );
    const defs : Array<string> = [];
    for( const object of objects )
    {
        if( object.kind === SvgDocument.ObjectKind.SHAPE && object.fill.kind === SvgDocument.FillKind.GRADIENT )
            defs.push( gradientDef( object.id, object.fill.gradient ) );
        if( object.kind === SvgDocument.ObjectKind.IMAGE && object.crop !== null )
        {
            // the clipPath rect is in the node's local coordinate space (same origin as the image element)
            const c : SvgDocument.CropRect = object.crop;
            defs.push( `<clipPath id="${ cropClipId( object.id ) }"><rect x="${ c.x }" y="${ c.y }" width="${ c.width }" height="${ c.height }" /></clipPath>` );
        }
    }
    if( defs.length === 0 ) return "";
    return `<defs>${ defs.join( "" ) }</defs>`;
}

/** Build the background element for a page (a solid color rect; image/none produce nothing here). */
function backgroundRect( page : SvgDocument.Page ) : string
{
    if( page.background.kind === "color" && page.background.color !== null )
        return `<rect x="0" y="0" width="${ page.size.width }" height="${ page.size.height }" fill="${ page.background.color }" />`;
    return "";
}

/** The page's compiled content — style/defs/background/layers — WITHOUT an enclosing `<svg>` tag. Callers that
 *  need to place a page's artwork inside a coordinate system they already own (e.g. the export pipeline's
 *  print-production canvas, which wraps the page in a translated `<g>` for bleed/margin) use this directly
 *  rather than nesting a whole second `<svg>` inside their own — nested `<svg>` elements are valid SVG, but a
 *  `<g>` descendant of one that carries a non-identity `transform` can fail to rasterize in Chromium's
 *  `page.pdf()`/screenshot paths (reproduced directly: identical markup renders fine as a top-level `<svg>`,
 *  but the same transformed content silently disappears once nested one `<svg>` level deeper) — so anything
 *  destined for that pipeline stays in a single, non-nested `<svg>`. */
function compilePageContent( doc : SvgDocument.Doc, page : SvgDocument.Page, editorHitRect : boolean, excludeNodeId : string | null ) : string
{
    const defs : string = pageDefs( page );
    const style : string = fontStyle( doc );
    const background : string = backgroundRect( page );
    const hit : string = editorHitRect ? `<rect data-hit="background" x="0" y="0" width="${ page.size.width }" height="${ page.size.height }" fill="transparent" />` : "";
    const layers : string = page.layers
        .map( ( layer : SvgDocument.Layer ) : string => compileLayer( doc, layer, excludeNodeId ) )
        .join( "" );
    return `${ style }${ defs }${ hit }${ background }${ layers }`;
}

/** Shared page-compilation core — wraps {@link compilePageContent} in a complete, self-contained `<svg>`.
 *  editorZoom non-null: SVG uses explicit pixel dimensions so the rendered size exactly matches the
 *  CSS-sized container — avoids percentage-resolution ambiguity that causes selection-box offsets at zoom ≠ 1.
 *  editorZoom null: SVG uses absolute pt dimensions for standalone export (self-contained file). */
function compile( doc : SvgDocument.Doc, page : SvgDocument.Page, editorHitRect : boolean, editorZoom : number | null, excludeNodeId : string | null = null ) : string
{
    const content : string = compilePageContent( doc, page, editorHitRect, excludeNodeId );
    // editor: explicit pixel dimensions + display:block (no CSS selector needed, no size ambiguity)
    // export: pt dimensions so the SVG is self-contained for external consumers
    const sizeAttrs : string = editorZoom !== null
        ? `width="${ page.size.width * editorZoom }" height="${ page.size.height * editorZoom }" style="display:block"`
        : `width="${ page.size.width }pt" height="${ page.size.height }pt"`;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${ page.size.width } ${ page.size.height }" ${ sizeAttrs }>${ content }</svg>`;
}

/** Compile a page to a complete, self-contained SVG string (for export — absolute pt dimensions). */
export function compilePage( doc : SvgDocument.Doc, page : SvgDocument.Page ) : string
{
    return compile( doc, page, false, null );
}

/** Compile a page's content only — no enclosing `<svg>` — for a caller that already owns the outer `<svg>` and
 *  just needs to place the page's artwork inside its own `<g>` (see {@link compilePageContent}'s doc comment
 *  for why nesting a whole second `<svg>` there is unsafe). */
export function compilePageArtwork( doc : SvgDocument.Doc, page : SvgDocument.Page ) : string
{
    return compilePageContent( doc, page, false, null );
}

/** Compile a page for the editor canvas — explicit pixel dimensions at the given zoom level guarantee the
 *  SVG's rendered size matches the CSS container exactly, keeping selection boxes aligned at any zoom. */
export function compilePageForEditor( doc : SvgDocument.Doc, page : SvgDocument.Page, zoom : number, excludeNodeId : string | null = null ) : string
{
    return compile( doc, page, true, zoom, excludeNodeId );
}
