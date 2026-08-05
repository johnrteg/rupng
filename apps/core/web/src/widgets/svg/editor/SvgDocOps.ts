//
import { SvgDocument } from "@repo/api";

//
// SvgDocOps — pure, immutable helpers for reading + transforming a SvgDocument.Doc (no React). Components
// build the next doc with these and dispatch SET_DOC; keeping the tree walks here means the reducer stays
// simple and the mutations are reused across the inspector, canvas, and layers panel.
//

/** Find a page by id. */
export function pageById( doc : SvgDocument.Doc, pageId : string ) : SvgDocument.Page | undefined
{
    return doc.pages.find( ( page : SvgDocument.Page ) : boolean => page.id === pageId );
}

/** Find an object by id anywhere in the doc (recursing groups); undefined when absent. */
export function findObject( doc : SvgDocument.Doc, objectId : string ) : SvgDocument.ObjectNode | undefined
{
    for( const page of doc.pages )
        for( const layer of page.layers )
        {
            const found : SvgDocument.ObjectNode | undefined = findInList( layer.objects, objectId );
            if( found !== undefined ) return found;
        }
    return undefined;
}

/** Find an object by id within a flat object list (recursing into groups). */
function findInList( objects : Array<SvgDocument.ObjectNode>, objectId : string ) : SvgDocument.ObjectNode | undefined
{
    for( const object of objects )
    {
        if( object.id === objectId ) return object;
        if( object.kind === SvgDocument.ObjectKind.GROUP )
        {
            const nested : SvgDocument.ObjectNode | undefined = findInList( object.objects, objectId );
            if( nested !== undefined ) return nested;
        }
    }
    return undefined;
}

/** Replace an object (matched by id, anywhere, recursing groups) with `next`, returning a new doc. */
export function replaceObject( doc : SvgDocument.Doc, objectId : string, next : SvgDocument.ObjectNode ) : SvgDocument.Doc
{
    const pages : Array<SvgDocument.Page> = doc.pages.map( ( page : SvgDocument.Page ) : SvgDocument.Page =>
    {
        const layers : Array<SvgDocument.Layer> = page.layers.map( ( layer : SvgDocument.Layer ) : SvgDocument.Layer => ( { ...layer, objects: replaceInList( layer.objects, objectId, next ) } ) );
        return { ...page, layers };
    } );
    return { ...doc, pages };
}

/** Replace an object by id within a list (recursing into groups). */
function replaceInList( objects : Array<SvgDocument.ObjectNode>, objectId : string, next : SvgDocument.ObjectNode ) : Array<SvgDocument.ObjectNode>
{
    return objects.map( ( object : SvgDocument.ObjectNode ) : SvgDocument.ObjectNode =>
    {
        if( object.id === objectId ) return next;
        if( object.kind === SvgDocument.ObjectKind.GROUP ) return { ...object, objects: replaceInList( object.objects, objectId, next ) };
        return object;
    } );
}

/** Remove a set of objects (by id) from a layer of a page, returning a new doc. */
export function deleteObjects( doc : SvgDocument.Doc, pageId : string, layerId : string, ids : Array<string> ) : SvgDocument.Doc
{
    const pages : Array<SvgDocument.Page> = doc.pages.map( ( page : SvgDocument.Page ) : SvgDocument.Page =>
    {
        if( page.id !== pageId ) return page;
        const layers : Array<SvgDocument.Layer> = page.layers.map( ( layer : SvgDocument.Layer ) : SvgDocument.Layer =>
        {
            if( layer.id !== layerId ) return layer;
            const kept : Array<SvgDocument.ObjectNode> = layer.objects.filter( ( object : SvgDocument.ObjectNode ) : boolean => !ids.includes( object.id ) );
            return { ...layer, objects: kept };
        } );
        return { ...page, layers };
    } );
    return { ...doc, pages };
}

/** Add an object to the top of a layer's object list (renders last → on top), returning a new doc. */
export function addObject( doc : SvgDocument.Doc, pageId : string, layerId : string, node : SvgDocument.ObjectNode ) : SvgDocument.Doc
{
    const pages : Array<SvgDocument.Page> = doc.pages.map( ( page : SvgDocument.Page ) : SvgDocument.Page =>
    {
        if( page.id !== pageId ) return page;
        const layers : Array<SvgDocument.Layer> = page.layers.map( ( layer : SvgDocument.Layer ) : SvgDocument.Layer => ( layer.id === layerId ? { ...layer, objects: [ ...layer.objects, node ] } : layer ) );
        return { ...page, layers };
    } );
    return { ...doc, pages };
}

/** Merge a patch into one layer of one page, returning a new doc. */
export function updateLayer( doc : SvgDocument.Doc, pageId : string, layerId : string, patch : Partial<SvgDocument.Layer> ) : SvgDocument.Doc
{
    const pages : Array<SvgDocument.Page> = doc.pages.map( ( page : SvgDocument.Page ) : SvgDocument.Page =>
    {
        if( page.id !== pageId ) return page;
        const layers : Array<SvgDocument.Layer> = page.layers.map( ( layer : SvgDocument.Layer ) : SvgDocument.Layer => ( layer.id === layerId ? { ...layer, ...patch } : layer ) );
        return { ...page, layers };
    } );
    return { ...doc, pages };
}

/** Move an object within its layer to a new index (clamped to the valid range), returning a new doc.
 *  Index 0 = bottom of stack (rendered first); last index = top (rendered last). */
export function moveObjectInLayer( doc : SvgDocument.Doc, pageId : string, layerId : string, objectId : string, toIndex : number ) : SvgDocument.Doc
{
    const pages : Array<SvgDocument.Page> = doc.pages.map( ( page : SvgDocument.Page ) : SvgDocument.Page =>
    {
        if( page.id !== pageId ) return page;
        const layers : Array<SvgDocument.Layer> = page.layers.map( ( layer : SvgDocument.Layer ) : SvgDocument.Layer =>
        {
            if( layer.id !== layerId ) return layer;
            const currentIndex : number = layer.objects.findIndex( ( object : SvgDocument.ObjectNode ) : boolean => object.id === objectId );
            if( currentIndex < 0 ) return layer;
            const clamped : number = Math.max( 0, Math.min( layer.objects.length - 1, toIndex ) );
            const objects : Array<SvgDocument.ObjectNode> = [ ...layer.objects ];
            const removed : Array<SvgDocument.ObjectNode> = objects.splice( currentIndex, 1 );
            const moved   : SvgDocument.ObjectNode | undefined = removed[ 0 ];
            if( moved === undefined ) return layer;
            objects.splice( clamped, 0, moved );
            return { ...layer, objects };
        } );
        return { ...page, layers };
    } );
    return { ...doc, pages };
}

/** Append a new layer to a page, returning a new doc. */
export function addLayer( doc : SvgDocument.Doc, pageId : string, layer : SvgDocument.Layer ) : SvgDocument.Doc
{
    const pages : Array<SvgDocument.Page> = doc.pages.map( ( page : SvgDocument.Page ) : SvgDocument.Page => ( page.id === pageId ? { ...page, layers: [ ...page.layers, layer ] } : page ) );
    return { ...doc, pages };
}

/** Move a layer to a new index within its page — used for drag-and-drop layer reordering. */
export function moveLayer( doc : SvgDocument.Doc, pageId : string, layerId : string, toIndex : number ) : SvgDocument.Doc
{
    const pages : Array<SvgDocument.Page> = doc.pages.map( ( page : SvgDocument.Page ) : SvgDocument.Page =>
    {
        if( page.id !== pageId ) return page;
        const fromIndex : number = page.layers.findIndex( ( layer : SvgDocument.Layer ) : boolean => layer.id === layerId );
        if( fromIndex < 0 ) return page;
        // splice the layer out, then insert at the clamped target index
        const layers : Array<SvgDocument.Layer> = [ ...page.layers ];
        const moved : Array<SvgDocument.Layer> = layers.splice( fromIndex, 1 );
        const clampedIndex : number = Math.max( 0, Math.min( toIndex, layers.length ) );
        layers.splice( clampedIndex, 0, ...moved );
        return { ...page, layers };
    } );
    return { ...doc, pages };
}

/** An axis-aligned bounding box in doc space (pt), e.g. from {@link objectBounds}. */
export interface Bounds
{
    minX : number;
    minY : number;
    maxX : number;
    maxY : number;
}

/** The on-canvas axis-aligned bounding box of an object, accounting for its rotation — the box that
 *  encloses the object's (possibly rotated) rectangle, NOT its unrotated transform.x/y/width/height.
 *  Used for marquee-select hit-testing (and reusable anywhere else a rotation-aware bbox is needed). */
export function objectBounds( node : SvgDocument.ObjectNode ) : Bounds
{
    const t   : SvgDocument.Transform = node.transform;
    const cx  : number = t.x + t.width  / 2;
    const cy  : number = t.y + t.height / 2;
    const rad : number = ( t.rotation * Math.PI ) / 180;
    const cos : number = Math.cos( rad );
    const sin : number = Math.sin( rad );

    // the 4 corners in local space (relative to centre), rotated into doc space — same convention as the
    // compiler's `rotate(rotation, centreX, centreY)` (see SvgCompiler.ts's transformValue)
    const halfW : number = t.width  / 2;
    const halfH : number = t.height / 2;
    const localCorners : Array<{ x : number; y : number }> =
    [
        { x: -halfW, y: -halfH }, { x: halfW, y: -halfH },
        { x: halfW,  y:  halfH }, { x: -halfW, y: halfH },
    ];
    const worldXs : Array<number> = localCorners.map( ( p : { x : number; y : number } ) : number => cx + p.x * cos - p.y * sin );
    const worldYs : Array<number> = localCorners.map( ( p : { x : number; y : number } ) : number => cy + p.x * sin + p.y * cos );

    return { minX: Math.min( ...worldXs ), minY: Math.min( ...worldYs ), maxX: Math.max( ...worldXs ), maxY: Math.max( ...worldYs ) };
}

/** Whether an object's (rotation-aware) bounding box overlaps `rect` at all — a partial overlap counts, same
 *  as a fully-contained object (marquee-select semantics: drag a rect, select anything it touches). */
export function rectIntersectsObject( rect : Bounds, node : SvgDocument.ObjectNode ) : boolean
{
    const bounds : Bounds = objectBounds( node );
    return !( rect.maxX < bounds.minX || rect.minX > bounds.maxX || rect.maxY < bounds.minY || rect.minY > bounds.maxY );
}
