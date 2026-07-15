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

/** Append a new layer to a page, returning a new doc. */
export function addLayer( doc : SvgDocument.Doc, pageId : string, layer : SvgDocument.Layer ) : SvgDocument.Doc
{
    const pages : Array<SvgDocument.Page> = doc.pages.map( ( page : SvgDocument.Page ) : SvgDocument.Page => ( page.id === pageId ? { ...page, layers: [ ...page.layers, layer ] } : page ) );
    return { ...doc, pages };
}
