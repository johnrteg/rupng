//
import { SvgDocument } from "@repo/api";

import { SvgEditorState, SvgEditorAction, SvgEditorActionType, HistoryStack, HISTORY_MAX_SIZE, makeId } from "./SvgEditorModel";

//
// svgEditorReducer — the pure state transition for the SVG editor (no React). Every editor mutation flows
// through here so undo/redo can snapshot the document model. Snapshots are full-doc copies pushed onto a
// bounded ring (SVG_EDITOR_SPEC §6.5). Selection/tool/zoom are ephemeral and never enter history.
//

/** Push the current doc onto the history `past` ring (trimmed to the max) and clear the redo `future`. */
function pushHistory( history : HistoryStack, current : SvgDocument.Doc | null ) : HistoryStack
{
    if( current === null ) return { past: history.past, future: [], maxSize: HISTORY_MAX_SIZE };
    // keep only the most recent (maxSize) snapshots so the ring stays bounded
    const past : Array<SvgDocument.Doc> = [ ...history.past, current ].slice( -HISTORY_MAX_SIZE );
    return { past, future: [], maxSize: HISTORY_MAX_SIZE };
}

/** Deep-clone an object subtree with fresh ids throughout (group children recurse) — for paste. */
function cloneWithFreshIds( node : SvgDocument.ObjectNode ) : SvgDocument.ObjectNode
{
    // a group re-ids itself AND every descendant; other kinds just re-id themselves
    if( node.kind === SvgDocument.ObjectKind.GROUP )
    {
        const children : Array<SvgDocument.ObjectNode> = node.objects.map( ( child : SvgDocument.ObjectNode ) : SvgDocument.ObjectNode => cloneWithFreshIds( child ) );
        return { ...node, id: makeId(), objects: children };
    }
    return { ...node, id: makeId() };
}

/** Offset a node's transform by a small delta so a paste is visibly not on top of its source. */
function offsetNode( node : SvgDocument.ObjectNode, delta : number ) : SvgDocument.ObjectNode
{
    const transform : SvgDocument.Transform = { ...node.transform, x: node.transform.x + delta, y: node.transform.y + delta };
    return { ...node, transform };
}

/** Collect the top-level objects on the active layer whose ids are selected. */
function selectedObjects( doc : SvgDocument.Doc, activePage : string, activeLayer : string, selectedIds : Array<string> ) : Array<SvgDocument.ObjectNode>
{
    const page : SvgDocument.Page | undefined = doc.pages.find( ( candidate : SvgDocument.Page ) : boolean => candidate.id === activePage );
    if( page === undefined ) return [];
    const layer : SvgDocument.Layer | undefined = page.layers.find( ( candidate : SvgDocument.Layer ) : boolean => candidate.id === activeLayer );
    if( layer === undefined ) return [];
    return layer.objects.filter( ( object : SvgDocument.ObjectNode ) : boolean => selectedIds.includes( object.id ) );
}

/** Append objects to the active layer of the active page, returning a new doc. */
function appendToActiveLayer( doc : SvgDocument.Doc, activePage : string, activeLayer : string, additions : Array<SvgDocument.ObjectNode> ) : SvgDocument.Doc
{
    const pages : Array<SvgDocument.Page> = doc.pages.map( ( page : SvgDocument.Page ) : SvgDocument.Page =>
    {
        if( page.id !== activePage ) return page;
        const layers : Array<SvgDocument.Layer> = page.layers.map( ( layer : SvgDocument.Layer ) : SvgDocument.Layer =>
        {
            if( layer.id !== activeLayer ) return layer;
            return { ...layer, objects: [ ...layer.objects, ...additions ] };
        } );
        return { ...page, layers };
    } );
    return { ...doc, pages };
}

/** The pure editor reducer — maps (state, action) → next state. */
export function svgEditorReducer( state : SvgEditorState, action : SvgEditorAction ) : SvgEditorState
{
    switch( action.type )
    {
        // load a freshly-fetched doc — reset history + selection, mark clean, seed active page/layer
        case SvgEditorActionType.LOAD_DOC :
        {
            const firstPage : SvgDocument.Page | undefined = action.doc.pages[ 0 ];
            const firstLayer : SvgDocument.Layer | undefined = firstPage?.layers[ 0 ];
            return {
                ...state, doc: action.doc, selectedIds: [], hoveredId: null,
                activePage: firstPage?.id ?? "", activeLayer: firstLayer?.id ?? "",
                history: { past: [], future: [], maxSize: HISTORY_MAX_SIZE }, dirtyFlag: false,
            };
        }

        // commit a doc edit — snapshot the prior doc for undo, mark dirty for autosave
        case SvgEditorActionType.SET_DOC :
        {
            const history : HistoryStack = pushHistory( state.history, state.doc );
            return { ...state, doc: action.doc, history, dirtyFlag: true };
        }

        // undo — restore the newest past snapshot, pushing the current doc onto the redo stack
        case SvgEditorActionType.UNDO :
        {
            if( state.doc === null || state.history.past.length === 0 ) return state;
            const previous : SvgDocument.Doc = state.history.past[ state.history.past.length - 1 ];
            const past : Array<SvgDocument.Doc> = state.history.past.slice( 0, -1 );
            const future : Array<SvgDocument.Doc> = [ ...state.history.future, state.doc ].slice( -HISTORY_MAX_SIZE );
            return { ...state, doc: previous, history: { past, future, maxSize: HISTORY_MAX_SIZE }, dirtyFlag: true, selectedIds: [] };
        }

        // redo — restore the newest future snapshot, pushing the current doc back onto the undo stack
        case SvgEditorActionType.REDO :
        {
            if( state.doc === null || state.history.future.length === 0 ) return state;
            const next : SvgDocument.Doc = state.history.future[ state.history.future.length - 1 ];
            const future : Array<SvgDocument.Doc> = state.history.future.slice( 0, -1 );
            const past : Array<SvgDocument.Doc> = [ ...state.history.past, state.doc ].slice( -HISTORY_MAX_SIZE );
            return { ...state, doc: next, history: { past, future, maxSize: HISTORY_MAX_SIZE }, dirtyFlag: true, selectedIds: [] };
        }

        case SvgEditorActionType.SELECT_OBJECTS :
            return { ...state, selectedIds: action.ids };

        case SvgEditorActionType.CLEAR_SELECTION :
            return { ...state, selectedIds: [] };

        case SvgEditorActionType.SET_TOOL :
            return { ...state, tool: action.tool };

        case SvgEditorActionType.SET_ZOOM :
            return { ...state, zoom: action.zoom };

        case SvgEditorActionType.SET_PAN :
            return { ...state, panX: action.x, panY: action.y };

        case SvgEditorActionType.SET_ACTIVE_PAGE :
            return { ...state, activePage: action.pageId, selectedIds: [] };

        case SvgEditorActionType.SET_ACTIVE_LAYER :
            return { ...state, activeLayer: action.layerId };

        // copy — snapshot the selected objects into the clipboard (no doc change)
        case SvgEditorActionType.COPY :
        {
            if( state.doc === null ) return state;
            const picked : Array<SvgDocument.ObjectNode> = selectedObjects( state.doc, state.activePage, state.activeLayer, state.selectedIds );
            return { ...state, clipboard: picked.length > 0 ? picked : state.clipboard };
        }

        // paste — clone the clipboard (fresh ids + offset) onto the active layer, snapshot for undo, select them
        case SvgEditorActionType.PASTE :
        {
            if( state.doc === null || state.clipboard === null || state.clipboard.length === 0 ) return state;
            const additions : Array<SvgDocument.ObjectNode> = state.clipboard.map( ( node : SvgDocument.ObjectNode ) : SvgDocument.ObjectNode => offsetNode( cloneWithFreshIds( node ), 10 ) );
            const nextDoc : SvgDocument.Doc = appendToActiveLayer( state.doc, state.activePage, state.activeLayer, additions );
            const history : HistoryStack = pushHistory( state.history, state.doc );
            const selectedIds : Array<string> = additions.map( ( node : SvgDocument.ObjectNode ) : string => node.id );
            return { ...state, doc: nextDoc, history, dirtyFlag: true, selectedIds };
        }

        case SvgEditorActionType.CLEAR_DIRTY :
            return { ...state, dirtyFlag: false };

        case SvgEditorActionType.SET_INSPECTOR_MODE :
            return { ...state, inspectorMode: action.mode };

        default :
            return state;
    }
}

export default svgEditorReducer;
