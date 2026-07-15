//
import { SvgDocument } from "@repo/api";

//
// SvgCompiler — the pure (no React) compiler that turns a SvgDocument.Doc + one Page into a complete SVG
// string. This is the single rendering path: the canvas shows the compiled markup, and the export pipeline
// serializes the same output. Positions are in points and map 1:1 to the SVG user space (viewBox in pt).
//
// Layout: <svg viewBox> → <defs> (gradients) → <style> (@import font stylesheets) → background → layers →
// each object composed under its decomposed transform, tagged with data-id for click hit-testing.
//

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
        case "solid"    : return fill.color;
        case "gradient" : return `url(#${ gradientId( objectId ) })`;
        case "pattern"  : return `url(#${ fill.pattern })`;
        case "none"     : return "none";
        default         : return "none";
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
    if( gradient.type === "radial" )
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

/** Compile a text object's inner markup (a <text> with a <tspan> per styled span). */
function compileText( node : SvgDocument.TextNode ) : string
{
    // one tspan per span carries its own font styling; the first line sits on the baseline
    const spans : string = node.content
        .map( ( span : SvgDocument.TextSpan ) : string => compileTextSpan( span ) )
        .join( "" );
    const firstStyle : SvgDocument.TextStyle | undefined = node.content[ 0 ]?.style;
    const baseline : number = firstStyle?.fontSize ?? 16;
    return `<text x="0" y="${ baseline }">${ spans }</text>`;
}

/** Compile one styled text span to a <tspan>. */
function compileTextSpan( span : SvgDocument.TextSpan ) : string
{
    const style : SvgDocument.TextStyle = span.style;
    const text : string = escapeXml( span.text );
    return `<tspan font-family="${ escapeXml( String( style.fontFamily ) )}" font-weight="${ style.fontWeight }" font-size="${ style.fontSize }" fill="${ style.color }" text-anchor="${ anchorForAlign( style.align ) }">${ text }</tspan>`;
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
            return `<path d="${ escapeXml( node.pathData ?? "" ) }" ${ paint } />`;
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

/** Compile an image object to an <image> element. */
function compileImage( doc : SvgDocument.Doc, node : SvgDocument.ImageNode ) : string
{
    const href : string = assetUrl( doc, node.assetId );
    return `<image href="${ escapeXml( href ) }" x="0" y="0" width="${ node.transform.width }" height="${ node.transform.height }" preserveAspectRatio="xMidYMid slice" />`;
}

/** Compile a single object (any kind) into its transform group, tagged with its data-id for hit-testing. */
function compileObject( doc : SvgDocument.Doc, node : SvgDocument.ObjectNode ) : string
{
    if( node.hidden ) return "";
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
        .map( ( child : SvgDocument.ObjectNode ) : string => compileObject( doc, child ) )
        .join( "" );
}

/** Compile one layer's visible objects (a hidden/lockless layer still paints; hidden layers are skipped). */
function compileLayer( doc : SvgDocument.Doc, layer : SvgDocument.Layer ) : string
{
    if( layer.hidden ) return "";
    const objects : string = layer.objects
        .map( ( object : SvgDocument.ObjectNode ) : string => compileObject( doc, object ) )
        .join( "" );
    return `<g data-layer="${ layer.id }" opacity="${ layer.opacity }">${ objects }</g>`;
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

/** Build the <defs> block (gradient definitions for every gradient-filled shape on the page). */
function pageDefs( page : SvgDocument.Page ) : string
{
    const objects : Array<SvgDocument.ObjectNode> = flattenObjects( page.layers.flatMap( ( layer : SvgDocument.Layer ) : Array<SvgDocument.ObjectNode> => layer.objects ) );
    const defs : Array<string> = [];
    for( const object of objects )
    {
        if( object.kind === SvgDocument.ObjectKind.SHAPE && object.fill.kind === "gradient" )
            defs.push( gradientDef( object.id, object.fill.gradient ) );
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

/** Shared page-compilation core; `editorHitRect` adds a transparent full-page rect for background clicks. */
function compile( doc : SvgDocument.Doc, page : SvgDocument.Page, editorHitRect : boolean ) : string
{
    const defs : string = pageDefs( page );
    const style : string = fontStyle( doc );
    const background : string = backgroundRect( page );
    const hit : string = editorHitRect ? `<rect data-hit="background" x="0" y="0" width="${ page.size.width }" height="${ page.size.height }" fill="transparent" />` : "";
    const layers : string = page.layers
        .map( ( layer : SvgDocument.Layer ) : string => compileLayer( doc, layer ) )
        .join( "" );
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${ page.size.width } ${ page.size.height }" width="${ page.size.width }" height="${ page.size.height }">${ style }${ defs }${ hit }${ background }${ layers }</svg>`;
}

/** Compile a page to a complete, self-contained SVG string (for display + export). */
export function compilePage( doc : SvgDocument.Doc, page : SvgDocument.Page ) : string
{
    return compile( doc, page, false );
}

/** Compile a page for the editor canvas — identical, plus a transparent background rect for click detection. */
export function compilePageForEditor( doc : SvgDocument.Doc, page : SvgDocument.Page ) : string
{
    return compile( doc, page, true );
}
