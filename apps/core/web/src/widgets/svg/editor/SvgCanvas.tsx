//
import React from "react";
import { JSX } from "react";

import { Box, useTheme } from "@mui/material";
import { Theme } from "@mui/material/styles";

import { SvgDocument, compilePageForEditor } from "@repo/api";

import { SvgEditorContext, SvgEditorContextValue } from "@widgets/svg/editor/SvgEditorContext";
import { SvgEditorActionType, ToolMode, DEFAULT_SHAPE, DEFAULT_LINE_STROKE, DEFAULT_TEXT_STYLE, makeId, defaultTransform, BezierAnchor, buildBezierPathData, catmullRomSmooth, PathAnchor, parseBezierAnchors, rebuildPathFromAnchors } from "@widgets/svg/editor/SvgEditorModel";
import { addObject, findObject, replaceObject, rectIntersectsObject } from "@widgets/svg/editor/SvgDocOps";
import type { Bounds } from "@widgets/svg/editor/SvgDocOps";
import InteractionOverlay from "@widgets/svg/editor/InteractionOverlay";

//
// SvgCanvas — the design surface. Renders the compiled page SVG inline with the InteractionOverlay layered
// above. All pointer events go on the outer container so tool mode is respected:
//   SELECT  → hit-test data-id for selection; Shift-click toggles multi-select
//   TEXT    → click creates a TextNode at the click position, then reverts to SELECT
//   SHAPE   → drag draws a rubber-band rect; release creates a rectangle ShapeNode
//   ELLIPSE → drag draws a rubber-band; release creates an ellipse ShapeNode
//   LINE    → drag draws a rubber-band line; release creates a PATH line ShapeNode
//   PEN     → click to place vertices, double-click to finalize (open polyline)
//   POLYGON → click to place vertices, double-click to finalize (closed polygon)
//   PAN     → reserved (scroll — not yet wired)
// Cursor CSS follows the active tool. Sizes to the page dimensions × zoom.
// The SVG uses width/height="100%" in its attributes so it always fills the CSS-sized container
// at any zoom level without depending on an external CSS selector.
//
export function SvgCanvas( props : SvgCanvas.Props ) : JSX.Element
{
    const editor : SvgEditorContextValue = React.useContext( SvgEditorContext );
    const zoom   : number = editor.state.zoom;
    const theme  : Theme  = useTheme();

    // recompile the page SVG; exclude the inline-editing node so only the textarea overlay is visible
    const editingNodeId : string | null = editor.state.editingNodeId;
    const svgMarkup : string = React.useMemo(
        () : string => compilePageForEditor( props.doc, props.page, zoom, editingNodeId ),
        [ props.doc, props.page, zoom, editingNodeId ],
    );

    const scaledWidth  : number = props.page.size.width  * zoom;
    const scaledHeight : number = props.page.size.height * zoom;

    // capture the pointer start position (client coords + container rect) when drawing a shape
    const drawStartRef : React.MutableRefObject<SvgCanvas.DrawStart | null> = React.useRef<SvgCanvas.DrawStart | null>( null );
    // the live rubber-band preview rect (px, relative to the outer container) — null when not drawing
    const [ preview, setPreview ] = React.useState<SvgCanvas.Preview | null>( null );
    // SELECT tool: marquee-drag start (empty-canvas mousedown) — additive is true when Shift was held,
    // meaning drag-end should ADD the intersecting objects to the existing selection rather than replace it
    const marqueeStartRef : React.MutableRefObject<SvgCanvas.MarqueeStart | null> = React.useRef<SvgCanvas.MarqueeStart | null>( null );
    // the live marquee-select rect (px, relative to the outer container) — null when not marquee-dragging
    const [ marqueePreview, setMarqueePreview ] = React.useState<SvgCanvas.MarqueeRect | null>( null );
    // last pointer position during a PAN drag (client coords), used to compute scroll deltas
    const panStartRef : React.MutableRefObject<{ clientX : number; clientY : number } | null> = React.useRef<{ clientX : number; clientY : number } | null>( null );
    // line rubber-band preview (CSS px relative to the canvas container)
    const [ linePreview, setLinePreview ] = React.useState<SvgCanvas.LinePreview | null>( null );
    // polyline/polygon in-progress points (doc points) + live cursor position
    const [ polyPoints, setPolyPoints ] = React.useState<Array<{ x : number; y : number }>>( [] );
    const [ polyCursor, setPolyCursor ] = React.useState<{ x : number; y : number } | null>( null );
    // polyline ref for synchronous access in double-click handlers
    const polyPointsRef : React.MutableRefObject<Array<{ x : number; y : number }>> = React.useRef<Array<{ x : number; y : number }>>( [] );
    // bezier drawing state
    const [ bezierAnchors, setBezierAnchors ] = React.useState<Array<BezierAnchor>>( [] );
    const [ bezierCursor,  setBezierCursor  ] = React.useState<{ x : number; y : number } | null>( null );
    // bezier draw drag: capturing a drag on the pointerdown to set a control handle
    const bezierDragStartRef : React.MutableRefObject<{ clientX : number; clientY : number; containerRect : DOMRect; anchorIndex : number } | null> =
        React.useRef<{ clientX : number; clientY : number; containerRect : DOMRect; anchorIndex : number } | null>( null );
    const bezierAnchorsRef : React.MutableRefObject<Array<BezierAnchor>> = React.useRef<Array<BezierAnchor>>( [] );
    // bezier edit drag: dragging an anchor circle or a control-handle square in bezier-edit mode.
    // dragKind distinguishes anchor vs handle. origTransform is captured at drag-start and held constant
    // so bounding-box math stays consistent (shapeNode.transform updates each frame and must NOT be used).
    const bezierEditDragRef : React.MutableRefObject<{ dragKind : "anchor" | "cpIn" | "cpOut"; targetIndex : number; startClientX : number; startClientY : number; origAnchors : Array<PathAnchor>; origTransform : SvgDocument.Transform } | null> =
        React.useRef<{ dragKind : "anchor" | "cpIn" | "cpOut"; targetIndex : number; startClientX : number; startClientY : number; origAnchors : Array<PathAnchor>; origTransform : SvgDocument.Transform } | null>( null );

    // cursor CSS per tool
    const TOOL_CURSOR : Record<ToolMode, string> =
    {
        [ ToolMode.SELECT ]  : "default",
        [ ToolMode.TEXT ]    : "text",
        [ ToolMode.SHAPE ]   : "crosshair",
        [ ToolMode.ELLIPSE ] : "crosshair",
        [ ToolMode.LINE ]    : "crosshair",
        [ ToolMode.PEN ]     : "crosshair",
        [ ToolMode.POLYGON ] : "crosshair",
        [ ToolMode.BEZIER ]  : "crosshair",
        [ ToolMode.IMAGE ]   : "copy",
        [ ToolMode.PAN ]     : "grab",
        [ ToolMode.ZOOM ]    : "zoom-in",
    };

    ////////////////////////////////////////////////////////////////////////////////////////////
    // reset all in-progress drawing state when the active tool changes
    function resetDrawState() : void
    {
        setLinePreview( null );
        setPolyPoints( [] );
        setPolyCursor( null );
        setBezierAnchors( [] );
        setBezierCursor( null );
        polyPointsRef.current = [];
        bezierAnchorsRef.current = [];
        bezierDragStartRef.current = null;
        marqueeStartRef.current = null;
        setMarqueePreview( null );
    }

    // reset drawing state whenever the active tool switches so stale preview artefacts are cleared
    React.useEffect( resetDrawState, [ editor.state.tool ] );

    ////////////////////////////////////////////////////////////////////////////////////////////
    // convert absolute client coords to document points using the container rect at drag start
    function toDocPt( clientX : number, clientY : number, containerRect : DOMRect ) : { x : number; y : number }
    {
        return {
            x: ( clientX - containerRect.left ) / zoom,
            y: ( clientY - containerRect.top  ) / zoom,
        };
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // build a rubber-band preview rect (px) from two client points + the stored container rect
    function previewFromDrag( clientX : number, clientY : number, start : SvgCanvas.DrawStart ) : SvgCanvas.Preview
    {
        const startRelX : number = start.clientX - start.containerRect.left;
        const startRelY : number = start.clientY - start.containerRect.top;
        const curRelX   : number = clientX - start.containerRect.left;
        const curRelY   : number = clientY - start.containerRect.top;
        return {
            left   : Math.min( startRelX, curRelX ),
            top    : Math.min( startRelY, curRelY ),
            width  : Math.abs( curRelX - startRelX ),
            height : Math.abs( curRelY - startRelY ),
            ellipse: start.ellipse,
        };
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // build the marquee's live preview rect (px) from two client points + the stored container rect
    function marqueeRectFromDrag( clientX : number, clientY : number, start : SvgCanvas.MarqueeStart ) : SvgCanvas.MarqueeRect
    {
        const startRelX : number = start.clientX - start.containerRect.left;
        const startRelY : number = start.clientY - start.containerRect.top;
        const curRelX   : number = clientX - start.containerRect.left;
        const curRelY   : number = clientY - start.containerRect.top;
        return {
            left   : Math.min( startRelX, curRelX ),
            top    : Math.min( startRelY, curRelY ),
            width  : Math.abs( curRelX - startRelX ),
            height : Math.abs( curRelY - startRelY ),
        };
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // every top-level, visible object on the page eligible for marquee-select — objects on a hidden layer
    // (or hidden themselves) aren't rendered at all, so they can't be marquee-selected either; a selected
    // GROUP counts as one item (its own transform already bounds all its children, so no need to recurse)
    function selectableObjects( page : SvgDocument.Page ) : Array<SvgDocument.ObjectNode>
    {
        const objects : Array<SvgDocument.ObjectNode> = [];
        for( const layer of page.layers )
        {
            if( layer.hidden ) continue;
            for( const object of layer.objects )
                if( !object.hidden ) objects.push( object );
        }
        return objects;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // SELECT tool: resolve the object under the pointer from its compiler-stamped data-id.
    // Shift-click toggles membership in the current multi-selection; plain click replaces it.
    // Empty canvas begins a marquee drag instead — onCanvasPointerUp decides whether it ends up
    // selecting whatever the drag rect touched, or (a drag too small to count) just clears the selection.
    function handleSelectDown( event : React.PointerEvent<HTMLDivElement> ) : void
    {
        const target : Element = event.target as Element;
        const owner : Element | null = target.closest( "[data-id]" );
        const id : string | null = owner !== null ? owner.getAttribute( "data-id" ) : null;

        if( id === null )
        {
            const containerRect : DOMRect = event.currentTarget.getBoundingClientRect();
            marqueeStartRef.current = { clientX: event.clientX, clientY: event.clientY, containerRect, additive: event.shiftKey };
            event.currentTarget.setPointerCapture( event.pointerId );
            editor.dispatch( { type: SvgEditorActionType.SET_CROP_NODE, nodeId: null } );
            return;
        }

        if( event.shiftKey )
        {
            // toggle this id in the existing selection
            const current : Array<string> = editor.state.selectedIds;
            const next : Array<string> = current.includes( id )
                ? current.filter( ( selected : string ) : boolean => selected !== id )
                : [ ...current, id ];
            editor.dispatch( { type: SvgEditorActionType.SELECT_OBJECTS, ids: next } );
            return;
        }

        editor.dispatch( { type: SvgEditorActionType.SELECT_OBJECTS, ids: [ id ] } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // TEXT tool: create a TextNode at the click position and immediately switch back to SELECT
    function handleTextDown( event : React.PointerEvent<HTMLDivElement> ) : void
    {
        const containerRect : DOMRect = event.currentTarget.getBoundingClientRect();
        const pt : { x : number; y : number } = toDocPt( event.clientX, event.clientY, containerRect );
        const text : SvgDocument.TextNode =
        {
            id: makeId(), kind: SvgDocument.ObjectKind.TEXT, name: "Text",
            locked: false, hidden: false, opacity: 1, conditionalVisibility: null,
            transform: defaultTransform( pt.x, pt.y, 200, 50 ),
            role: SvgDocument.TextRole.BODY,
            content: [ { text: "Text", style: DEFAULT_TEXT_STYLE } ],
            pathId: null, curved: false, vertical: false,
        };
        const nextDoc : SvgDocument.Doc = addObject( props.doc, editor.state.activePage, editor.state.activeLayer, text );
        editor.dispatch( { type: SvgEditorActionType.SET_DOC, doc: nextDoc } );
        editor.dispatch( { type: SvgEditorActionType.SELECT_OBJECTS, ids: [ text.id ] } );
        editor.dispatch( { type: SvgEditorActionType.SET_TOOL, tool: ToolMode.SELECT } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // PAN tool: begin a scroll-drag — capture the pointer and record the current client position
    function handlePanDown( event : React.PointerEvent<HTMLDivElement> ) : void
    {
        panStartRef.current = { clientX: event.clientX, clientY: event.clientY };
        event.currentTarget.setPointerCapture( event.pointerId );
    }

    // PAN tool: scroll the parent container by the pointer delta and update the reference position
    function handlePanMove( event : React.PointerEvent<HTMLDivElement> ) : void
    {
        const start : { clientX : number; clientY : number } | null = panStartRef.current;
        if( start === null ) return;
        const dx : number = start.clientX - event.clientX;
        const dy : number = start.clientY - event.clientY;
        // the canvas's direct parent is the scroll container — scroll it by the drag delta
        const scrollContainer : HTMLElement | null = event.currentTarget.parentElement;
        if( scrollContainer !== null )
        {
            scrollContainer.scrollLeft += dx;
            scrollContainer.scrollTop  += dy;
        }
        panStartRef.current = { clientX: event.clientX, clientY: event.clientY };
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // SHAPE / ELLIPSE tool: begin a rubber-band drag — capture the pointer so move/up arrive even off-canvas
    function handleShapeDown( event : React.PointerEvent<HTMLDivElement>, isEllipse : boolean, isLine : boolean ) : void
    {
        const containerRect : DOMRect = event.currentTarget.getBoundingClientRect();
        drawStartRef.current = { clientX: event.clientX, clientY: event.clientY, containerRect, ellipse: isEllipse, isLine };
        event.currentTarget.setPointerCapture( event.pointerId );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // LINE tool: start a rubber-band drag — records a DrawStart with isLine=true
    function handleLineDown( event : React.PointerEvent<HTMLDivElement> ) : void
    {
        const containerRect : DOMRect = event.currentTarget.getBoundingClientRect();
        drawStartRef.current = { clientX: event.clientX, clientY: event.clientY, containerRect, ellipse: false, isLine: true };
        event.currentTarget.setPointerCapture( event.pointerId );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // PEN (polyline) + POLYGON tool: add one vertex on each click; keep the ref in sync for
    // synchronous access in the double-click handler which fires before state has flushed
    function handlePolyClick( event : React.MouseEvent<HTMLDivElement> ) : void
    {
        const containerRect : DOMRect = event.currentTarget.getBoundingClientRect();
        const pt : { x : number; y : number } = toDocPt( event.clientX, event.clientY, containerRect );
        const next : Array<{ x : number; y : number }> = [ ...polyPointsRef.current, pt ];
        polyPointsRef.current = next;
        setPolyPoints( next );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // PEN (polyline) + POLYGON tool: double-click finalizes the path.
    // Read from the ref (not state) so we always see the points placed by the two preceding clicks.
    // Remove trailing near-duplicate points that the two onClick events add before dblclick fires.
    function handlePolyDoubleClick( event : React.MouseEvent<HTMLDivElement> ) : void
    {
        event.preventDefault();
        const isClosed : boolean = editor.state.tool === ToolMode.POLYGON;
        const threshold : number = 5 / zoom;
        let trimmed : Array<{ x : number; y : number }> = [ ...polyPointsRef.current ];
        while( trimmed.length >= 2 )
        {
            const last : { x : number; y : number } = trimmed[ trimmed.length - 1 ];
            const prev : { x : number; y : number } = trimmed[ trimmed.length - 2 ];
            const dist : number = Math.hypot( last.x - prev.x, last.y - prev.y );
            if( dist < threshold )
            {
                trimmed = trimmed.slice( 0, -1 );
            }
            else break;
        }
        polyPointsRef.current = [];
        setPolyPoints( [] );
        setPolyCursor( null );
        if( trimmed.length >= 2 )
        {
            finalizePolyShape( trimmed, isClosed );
        }
        else
        {
            editor.dispatch( { type: SvgEditorActionType.SET_TOOL, tool: ToolMode.SELECT } );
        }
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // finalize a polyline or polygon from accumulated doc-space points (caller is responsible for
    // deduplication): compute a minimal bounding box, convert to local coords, build path data, commit
    function finalizePolyShape( worldPoints : Array<{ x : number; y : number }>, closed : boolean ) : void
    {
        if( worldPoints.length < 2 )
        {
            // not enough points — cancel and return to SELECT
            editor.dispatch( { type: SvgEditorActionType.SET_TOOL, tool: ToolMode.SELECT } );
            return;
        }

        // compute bounding box of all points
        const allX : Array<number> = worldPoints.map( ( p : { x : number; y : number } ) : number => p.x );
        const allY : Array<number> = worldPoints.map( ( p : { x : number; y : number } ) : number => p.y );
        const minX   : number = Math.min( ...allX );
        const minY   : number = Math.min( ...allY );
        const rawW   : number = Math.max( ...allX ) - minX;
        const rawH   : number = Math.max( ...allY ) - minY;
        const strokeW : number = DEFAULT_LINE_STROKE.width;
        const bboxW   : number = Math.max( rawW, strokeW );
        const bboxH   : number = Math.max( rawH, strokeW );

        // build an SVG path string in local (bounding-box) coordinates
        const pathData : string = worldPoints
            .map( ( p : { x : number; y : number }, index : number ) : string => `${ index === 0 ? "M" : "L" } ${ p.x - minX } ${ p.y - minY }` )
            .join( " " ) + ( closed ? " Z" : "" );

        const shape : SvgDocument.ShapeNode = {
            ...DEFAULT_SHAPE,
            id: makeId(), name: closed ? "Polygon" : "Polyline",
            shapeType: SvgDocument.ShapeType.PATH,
            pathData,
            fill  : closed ? DEFAULT_SHAPE.fill : { kind: SvgDocument.FillKind.NONE },
            stroke: DEFAULT_LINE_STROKE,
            transform: defaultTransform( minX, minY, bboxW, bboxH ),
        };
        const nextDoc : SvgDocument.Doc = addObject( props.doc, editor.state.activePage, editor.state.activeLayer, shape );
        editor.dispatch( { type: SvgEditorActionType.SET_DOC, doc: nextDoc } );
        editor.dispatch( { type: SvgEditorActionType.SELECT_OBJECTS, ids: [ shape.id ] } );
        editor.dispatch( { type: SvgEditorActionType.SET_TOOL, tool: ToolMode.SELECT } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // BEZIER tool: pointer-down places a new anchor and auto-smooths the preceding corner anchors via
    // Catmull-Rom so plain clicks produce curves (not a straight polyline). A user who drags from
    // the new anchor will override cpOut explicitly in handleBezierMove; auto-smoothed anchors
    // (cpOut !== null from a prior auto-smooth) are preserved unchanged by catmullRomSmooth.
    function handleBezierDown( event : React.PointerEvent<HTMLDivElement> ) : void
    {
        const containerRect : DOMRect = event.currentTarget.getBoundingClientRect();
        const pt : { x : number; y : number } = toDocPt( event.clientX, event.clientY, containerRect );
        // corner anchor — dragging upgrades to smooth; catmullRomSmooth fills in the rest
        const newAnchor : BezierAnchor = { x: pt.x, y: pt.y, cpOutX: null, cpOutY: null };
        const raw : Array<BezierAnchor> = [ ...bezierAnchorsRef.current, newAnchor ];
        // retroactively smooth any preceding corner anchors now that a new neighbour is known
        const smoothed : Array<BezierAnchor> = catmullRomSmooth( raw );
        bezierAnchorsRef.current = smoothed;
        setBezierAnchors( smoothed );
        bezierDragStartRef.current = {
            clientX: event.clientX, clientY: event.clientY,
            containerRect, anchorIndex: smoothed.length - 1,
        };
        event.currentTarget.setPointerCapture( event.pointerId );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // BEZIER tool: pointer-move updates the live cursor AND upgrades the most-recently-added
    // anchor into a smooth anchor if the user has dragged far enough to define a control handle
    function handleBezierMove( event : React.PointerEvent<HTMLDivElement> ) : void
    {
        const containerRect : DOMRect = event.currentTarget.getBoundingClientRect();
        const cursorPt : { x : number; y : number } = toDocPt( event.clientX, event.clientY, containerRect );
        setBezierCursor( cursorPt );

        const dragStart : { clientX : number; clientY : number; containerRect : DOMRect; anchorIndex : number } | null = bezierDragStartRef.current;
        if( dragStart === null ) return;

        // compute drag handle in doc-space
        const dx : number = ( event.clientX - dragStart.clientX ) / zoom;
        const dy : number = ( event.clientY - dragStart.clientY ) / zoom;
        const dragLen : number = Math.hypot( dx, dy );
        if( dragLen < 3 / zoom ) return;    // not dragging yet; keep as corner

        // upgrade the anchor at dragStart.anchorIndex to a smooth anchor
        const anchors : Array<BezierAnchor> = [ ...bezierAnchorsRef.current ];
        const orig : BezierAnchor | undefined = anchors[ dragStart.anchorIndex ];
        if( orig === undefined ) return;
        anchors[ dragStart.anchorIndex ] = { ...orig, cpOutX: dx, cpOutY: dy };
        bezierAnchorsRef.current = anchors;
        setBezierAnchors( anchors );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // BEZIER tool: pointer-up finalizes the current anchor (corner or smooth based on drag distance)
    function handleBezierUp( _event : React.PointerEvent<HTMLDivElement> ) : void
    {
        // anchor was already committed in handleBezierMove; clear the drag-start reference
        bezierDragStartRef.current = null;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // BEZIER tool: double-click finalizes the open bezier path
    // Removes trailing near-duplicate anchors added by the two onClick events before dblclick
    function handleBezierDoubleClick( event : React.MouseEvent<HTMLDivElement> ) : void
    {
        event.preventDefault();
        const threshold : number = 5 / zoom;
        let trimmed : Array<BezierAnchor> = [ ...bezierAnchorsRef.current ];
        while( trimmed.length >= 2 )
        {
            const last : BezierAnchor = trimmed[ trimmed.length - 1 ];
            const prev : BezierAnchor = trimmed[ trimmed.length - 2 ];
            const dist : number = Math.hypot( last.x - prev.x, last.y - prev.y );
            if( dist < threshold )
            {
                trimmed = trimmed.slice( 0, -1 );
            }
            else break;
        }
        bezierAnchorsRef.current = [];
        setBezierAnchors( [] );
        setBezierCursor( null );
        if( trimmed.length >= 2 )
        {
            finalizeBezierShape( trimmed, false );
        }
        else
        {
            editor.dispatch( { type: SvgEditorActionType.SET_TOOL, tool: ToolMode.SELECT } );
        }
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // BEZIER tool: convert accumulated BezierAnchors into a ShapeNode with PATH type and commit
    function finalizeBezierShape( worldAnchors : Array<BezierAnchor>, closed : boolean ) : void
    {
        if( worldAnchors.length < 2 )
        {
            editor.dispatch( { type: SvgEditorActionType.SET_TOOL, tool: ToolMode.SELECT } );
            return;
        }
        // compute the bounding box from all anchor positions (ignoring control handles for the bbox)
        const allX : Array<number> = worldAnchors.map( ( a : BezierAnchor ) : number => a.x );
        const allY : Array<number> = worldAnchors.map( ( a : BezierAnchor ) : number => a.y );
        const minX   : number = Math.min( ...allX );
        const minY   : number = Math.min( ...allY );
        const rawW   : number = Math.max( ...allX ) - minX;
        const rawH   : number = Math.max( ...allY ) - minY;
        const strokeW : number = DEFAULT_LINE_STROKE.width;
        const bboxW   : number = Math.max( rawW, strokeW );
        const bboxH   : number = Math.max( rawH, strokeW );
        // translate all anchor positions to local (bounding-box) space
        const localAnchors : Array<BezierAnchor> = worldAnchors.map(
            ( a : BezierAnchor ) : BezierAnchor => ( { ...a, x: a.x - minX, y: a.y - minY } )
        );
        const pathData : string = buildBezierPathData( localAnchors, closed );
        const shape : SvgDocument.ShapeNode = {
            ...DEFAULT_SHAPE,
            id: makeId(), name: "Bezier",
            shapeType: SvgDocument.ShapeType.PATH,
            pathData,
            fill  : { kind: SvgDocument.FillKind.NONE },
            stroke: DEFAULT_LINE_STROKE,
            transform: defaultTransform( minX, minY, bboxW, bboxH ),
        };
        const nextDoc : SvgDocument.Doc = addObject( props.doc, editor.state.activePage, editor.state.activeLayer, shape );
        editor.dispatch( { type: SvgEditorActionType.SET_DOC, doc: nextDoc } );
        editor.dispatch( { type: SvgEditorActionType.SELECT_OBJECTS, ids: [ shape.id ] } );
        editor.dispatch( { type: SvgEditorActionType.SET_TOOL, tool: ToolMode.SELECT } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // BEZIER EDIT MODE: apply a move delta to a single anchor and its control handles.
    // Extracted to component scope so it can be used as a single-expression map callback.
    function applyAnchorDelta( anchor : PathAnchor, index : number, targetIndex : number, dx : number, dy : number ) : PathAnchor
    {
        if( index !== targetIndex ) return anchor;
        return {
            x    : anchor.x + dx,
            y    : anchor.y + dy,
            cpIn : anchor.cpIn  !== null ? { x: anchor.cpIn.x  + dx, y: anchor.cpIn.y  + dy } : null,
            cpOut: anchor.cpOut !== null ? { x: anchor.cpOut.x + dx, y: anchor.cpOut.y + dy } : null,
        };
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // BEZIER EDIT MODE: apply a move delta to only a control handle (cpIn or cpOut) of one anchor.
    // The anchor position stays fixed; only the handle moves so the tangent direction changes.
    function applyHandleDelta( anchor : PathAnchor, index : number, targetIndex : number, kind : "cpIn" | "cpOut", dx : number, dy : number ) : PathAnchor
    {
        if( index !== targetIndex ) return anchor;
        if( kind === "cpOut" )
        {
            const newCpOut : { x : number; y : number } | null = anchor.cpOut !== null
                ? { x: anchor.cpOut.x + dx, y: anchor.cpOut.y + dy }
                : null;
            return { ...anchor, cpOut: newCpOut };
        }
        const newCpIn : { x : number; y : number } | null = anchor.cpIn !== null
            ? { x: anchor.cpIn.x + dx, y: anchor.cpIn.y + dy }
            : null;
        return { ...anchor, cpIn: newCpIn };
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // BEZIER EDIT MODE: pointer-down — detect whether the user clicked an anchor circle
    // (data-bezier-anchor) or a control-handle square (data-bezier-cp="N-in"/"N-out") to begin
    // a drag, or clicked background to exit edit mode
    function handleBezierEditDown( event : React.PointerEvent<HTMLDivElement> ) : void
    {
        const target      : Element       = event.target as Element;
        const anchorAttr  : string | null = target.getAttribute( "data-bezier-anchor" );
        const cpAttr      : string | null = target.getAttribute( "data-bezier-cp" );

        if( anchorAttr === null && cpAttr === null )
        {
            // clicked outside any handle — exit bezier edit mode
            editor.dispatch( { type: SvgEditorActionType.SET_BEZIER_EDIT, nodeId: null } );
            return;
        }

        // determine drag kind and target index from whichever attribute was found
        let dragKind    : "anchor" | "cpIn" | "cpOut" = "anchor";
        let targetIndex : number = 0;
        if( anchorAttr !== null )
        {
            dragKind    = "anchor";
            targetIndex = parseInt( anchorAttr, 10 );
        }
        else
        {
            // cpAttr format: "${anchorIndex}-in" or "${anchorIndex}-out"
            const parts : Array<string> = ( cpAttr ?? "" ).split( "-" );
            targetIndex = parseInt( parts[ 0 ] ?? "0", 10 );
            dragKind    = parts[ 1 ] === "out" ? "cpOut" : "cpIn";
        }

        const editNodeId : string | null = editor.state.bezierEditNodeId;
        if( editNodeId === null || editor.state.doc === null ) return;
        const node : SvgDocument.ObjectNode | undefined = findObject( editor.state.doc, editNodeId );
        if( node === undefined || node.kind !== SvgDocument.ObjectKind.SHAPE ) return;
        const shapeNode     : SvgDocument.ShapeNode     = node as SvgDocument.ShapeNode;
        const origAnchors   : Array<PathAnchor>          = parseBezierAnchors( shapeNode.pathData ?? "" );
        const origTransform : SvgDocument.Transform      = shapeNode.transform;
        bezierEditDragRef.current = { dragKind, targetIndex, startClientX: event.clientX, startClientY: event.clientY, origAnchors, origTransform };
        event.currentTarget.setPointerCapture( event.pointerId );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // BEZIER EDIT MODE: pointer-move — drag either an anchor (with its handles) or a single
    // control handle. Anchor drags recompute the bounding box; handle drags only update pathData.
    function handleBezierEditMove( event : React.PointerEvent<HTMLDivElement> ) : void
    {
        const drag : { dragKind : "anchor" | "cpIn" | "cpOut"; targetIndex : number; startClientX : number; startClientY : number; origAnchors : Array<PathAnchor>; origTransform : SvgDocument.Transform } | null = bezierEditDragRef.current;
        if( drag === null || editor.state.bezierEditNodeId === null || editor.state.doc === null ) return;

        const dx : number = ( event.clientX - drag.startClientX ) / zoom;
        const dy : number = ( event.clientY - drag.startClientY ) / zoom;

        const editedNode : SvgDocument.ObjectNode | undefined = findObject( editor.state.doc, editor.state.bezierEditNodeId );
        if( editedNode === undefined || editedNode.kind !== SvgDocument.ObjectKind.SHAPE ) return;
        const shapeNode    : SvgDocument.ShapeNode = editedNode as SvgDocument.ShapeNode;
        const isClosedPath : boolean = ( shapeNode.pathData ?? "" ).endsWith( " Z" );

        if( drag.dragKind === "anchor" )
        {
            // move the anchor AND its control handles (handles stay at the same relative offset)
            const moved : Array<PathAnchor> = drag.origAnchors.map(
                ( anchor : PathAnchor, index : number ) : PathAnchor => applyAnchorDelta( anchor, index, drag.targetIndex, dx, dy )
            );

            // use origTransform — shapeNode.transform changes each frame and must NOT be used as origin
            const origTx  : number = drag.origTransform.x;
            const origTy  : number = drag.origTransform.y;
            const worldXs : Array<number> = moved.map( ( a : PathAnchor ) : number => origTx + a.x );
            const worldYs : Array<number> = moved.map( ( a : PathAnchor ) : number => origTy + a.y );
            const newMinX : number = Math.min( ...worldXs );
            const newMinY : number = Math.min( ...worldYs );
            const newMaxX : number = Math.max( ...worldXs );
            const newMaxY : number = Math.max( ...worldYs );
            const strokeW : number = shapeNode.stroke?.width ?? 2;
            const newW    : number = Math.max( newMaxX - newMinX, strokeW );
            const newH    : number = Math.max( newMaxY - newMinY, strokeW );

            // shift all anchor + handle coords into the new local (bbox-origin) coordinate system
            const shiftX      : number = origTx - newMinX;
            const shiftY      : number = origTy - newMinY;
            const reLocalized : Array<PathAnchor> = moved.map(
                ( a : PathAnchor ) : PathAnchor => ( {
                    ...a,
                    x    : a.x + shiftX,
                    y    : a.y + shiftY,
                    cpIn : a.cpIn  !== null ? { x: a.cpIn.x  + shiftX, y: a.cpIn.y  + shiftY } : null,
                    cpOut: a.cpOut !== null ? { x: a.cpOut.x + shiftX, y: a.cpOut.y + shiftY } : null,
                } )
            );

            const nextPathData  : string = rebuildPathFromAnchors( reLocalized, isClosedPath );
            const nextTransform : SvgDocument.Transform = { ...shapeNode.transform, x: newMinX, y: newMinY, width: newW, height: newH };
            const nextNode  : SvgDocument.ShapeNode = { ...shapeNode, pathData: nextPathData, transform: nextTransform };
            const nextDoc   : SvgDocument.Doc = replaceObject( editor.state.doc, editor.state.bezierEditNodeId, nextNode );
            editor.dispatch( { type: SvgEditorActionType.UPDATE_DOC_LIVE, doc: nextDoc } );
        }
        else
        {
            // control handle drag: move cpIn or cpOut only — anchor stays fixed, so no bbox update
            const kind    : "cpIn" | "cpOut" = drag.dragKind === "cpOut" ? "cpOut" : "cpIn";
            const moved   : Array<PathAnchor> = drag.origAnchors.map(
                ( anchor : PathAnchor, index : number ) : PathAnchor => applyHandleDelta( anchor, index, drag.targetIndex, kind, dx, dy )
            );
            const nextPathData : string = rebuildPathFromAnchors( moved, isClosedPath );
            const nextNode  : SvgDocument.ShapeNode = { ...shapeNode, pathData: nextPathData };
            const nextDoc   : SvgDocument.Doc = replaceObject( editor.state.doc, editor.state.bezierEditNodeId, nextNode );
            editor.dispatch( { type: SvgEditorActionType.UPDATE_DOC_LIVE, doc: nextDoc } );
        }
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // BEZIER EDIT MODE: pointer-up — commit the anchor drag as an undoable step
    function handleBezierEditUp( _event : React.PointerEvent<HTMLDivElement> ) : void
    {
        if( bezierEditDragRef.current === null || editor.state.bezierEditNodeId === null || editor.state.doc === null ) return;
        bezierEditDragRef.current = null;
        // current doc is already the live-updated one — take a snapshot for undo
        const snapshot : SvgDocument.Doc = editor.state.doc;
        editor.dispatch( { type: SvgEditorActionType.COMMIT_DOC, snapshot, doc: editor.state.doc } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // BEZIER EDIT MODE: render the control-handle lines and squares for one anchor point.
    // Extracted to component scope so it can be used as a single-expression map callback.
    function renderBezierAnchorPoint( anchor : PathAnchor, index : number, tx : number, ty : number ) : JSX.Element
    {
        const sx : number = tx + anchor.x * zoom;
        const sy : number = ty + anchor.y * zoom;
        const cpInEl : JSX.Element | null = anchor.cpIn !== null
            ?   <React.Fragment key={ `cpIn-${ index }` }>
                    <line x1={ tx + anchor.cpIn.x * zoom } y1={ ty + anchor.cpIn.y * zoom }
                          x2={ sx } y2={ sy }
                          stroke={ theme.palette.primary.light } strokeWidth={ 1 } />
                    <rect x={ tx + anchor.cpIn.x * zoom - 5 } y={ ty + anchor.cpIn.y * zoom - 5 }
                          width={ 10 } height={ 10 }
                          fill={ theme.palette.background.paper } stroke={ theme.palette.primary.light } strokeWidth={ 1.5 }
                          style={{ pointerEvents: "all", cursor: "move" }}
                          data-bezier-cp={ `${ index }-in` } />
                </React.Fragment>
            : null;
        const cpOutEl : JSX.Element | null = anchor.cpOut !== null
            ?   <React.Fragment key={ `cpOut-${ index }` }>
                    <line x1={ sx } y1={ sy }
                          x2={ tx + anchor.cpOut.x * zoom } y2={ ty + anchor.cpOut.y * zoom }
                          stroke={ theme.palette.primary.light } strokeWidth={ 1 } />
                    <rect x={ tx + anchor.cpOut.x * zoom - 5 } y={ ty + anchor.cpOut.y * zoom - 5 }
                          width={ 10 } height={ 10 }
                          fill={ theme.palette.background.paper } stroke={ theme.palette.primary.light } strokeWidth={ 1.5 }
                          style={{ pointerEvents: "all", cursor: "move" }}
                          data-bezier-cp={ `${ index }-out` } />
                </React.Fragment>
            : null;
        return  <React.Fragment key={ index }>
                    { cpInEl }
                    { cpOutEl }
                    <circle cx={ sx } cy={ sy } r={ 5 }
                            fill={ theme.palette.background.paper } stroke={ theme.palette.primary.main } strokeWidth={ 2 }
                            style={{ pointerEvents: "all", cursor: "move" }}
                            data-bezier-anchor={ index } />
                </React.Fragment>;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // BEZIER EDIT MODE: render the full anchor overlay for the node currently being edited
    function renderBezierEditOverlay() : JSX.Element | null
    {
        if( editor.state.bezierEditNodeId === null || editor.state.doc === null ) return null;
        const editNode : SvgDocument.ObjectNode | undefined = findObject( editor.state.doc, editor.state.bezierEditNodeId );
        if( editNode === undefined || editNode.kind !== SvgDocument.ObjectKind.SHAPE ) return null;
        const shapeNode : SvgDocument.ShapeNode = editNode as SvgDocument.ShapeNode;
        const anchors : Array<PathAnchor> = parseBezierAnchors( shapeNode.pathData ?? "" );
        const tx : number = shapeNode.transform.x * zoom;
        const ty : number = shapeNode.transform.y * zoom;
        return  <Box component="svg" sx={{ position: "absolute", inset: 0, width: "100%", height: "100%",
                                          pointerEvents: "none" }}>
                    { anchors.map( ( anchor : PathAnchor, index : number ) : JSX.Element => renderBezierAnchorPoint( anchor, index, tx, ty ) ) }
                </Box>;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // BEZIER tool draw preview: build the SVG path 'd' for the dashed live segment from the
    // last placed anchor to the cursor — curves if the last anchor has an exit handle so the
    // user can see the actual bezier arc shape before clicking the next point
    function buildLiveSegmentPath() : string
    {
        if( bezierCursor === null || bezierAnchors.length === 0 ) return "";
        const last  : BezierAnchor = bezierAnchors[ bezierAnchors.length - 1 ];
        const lx    : number       = last.x * zoom;
        const ly    : number       = last.y * zoom;
        const cx    : number       = bezierCursor.x * zoom;
        const cy    : number       = bezierCursor.y * zoom;
        if( last.cpOutX !== null && last.cpOutY !== null )
        {
            // cubic bezier: exit handle as cp1, cursor as both cp2 and endpoint (no entry handle yet)
            const cp1x : number = lx + last.cpOutX * zoom;
            const cp1y : number = ly + last.cpOutY * zoom;
            return `M ${ lx } ${ ly } C ${ cp1x } ${ cp1y } ${ cx } ${ cy } ${ cx } ${ cy }`;
        }
        return `M ${ lx } ${ ly } L ${ cx } ${ cy }`;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // BEZIER tool draw preview: render control-handle crossbars for ALL smooth anchors placed so far
    // (not just the last) so the user can see the tangent direction at each smooth anchor throughout drawing
    function renderBezierHandles() : JSX.Element | null
    {
        if( bezierAnchors.length === 0 ) return null;
        const elements : Array<JSX.Element> = [];
        bezierAnchors.forEach( ( anchor : BezierAnchor, index : number ) : void =>
        {
            if( anchor.cpOutX === null || anchor.cpOutY === null ) return;
            const ax  : number = anchor.x * zoom;
            const ay  : number = anchor.y * zoom;
            const hx  : number = ax + anchor.cpOutX * zoom;
            const hy  : number = ay + anchor.cpOutY * zoom;
            const mx  : number = ax - anchor.cpOutX * zoom;
            const my  : number = ay - anchor.cpOutY * zoom;
            elements.push(
                <line key={ `hl-${ index }` } x1={ mx } y1={ my } x2={ hx } y2={ hy }
                      stroke={ theme.palette.primary.main } strokeWidth={ 1 } strokeDasharray="3 2" />,
                <rect key={ `hh-${ index }` } x={ hx - 4 } y={ hy - 4 } width={ 8 } height={ 8 }
                      fill={ theme.palette.background.paper } stroke={ theme.palette.primary.main } strokeWidth={ 1.5 } />,
                <rect key={ `hm-${ index }` } x={ mx - 4 } y={ my - 4 } width={ 8 } height={ 8 }
                      fill={ theme.palette.background.paper } stroke={ theme.palette.primary.main } strokeWidth={ 1.5 } />,
            );
        } );
        if( elements.length === 0 ) return null;
        return <React.Fragment>{ elements }</React.Fragment>;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // register document-level keydown to finalize or cancel PEN/POLYGON/BEZIER drawing
    // when one of those tools is active (canvas may not have keyboard focus after click interactions)
    function registerDrawingKeyHandler() : ( () => void ) | void
    {
        const tool : ToolMode = editor.state.tool;
        const inBezierEdit : boolean = editor.state.bezierEditNodeId !== null;
        const isDrawing : boolean = tool === ToolMode.PEN || tool === ToolMode.POLYGON || tool === ToolMode.BEZIER;
        if( !isDrawing && !inBezierEdit ) return;

        const handleKeyDown : ( event : KeyboardEvent ) => void = ( event : KeyboardEvent ) : void =>
        {
            if( event.key === "Enter" )
            {
                event.preventDefault();
                if( tool === ToolMode.BEZIER )
                {
                    const trimmed : Array<BezierAnchor> = [ ...bezierAnchorsRef.current ];
                    bezierAnchorsRef.current = [];
                    setBezierAnchors( [] );
                    setBezierCursor( null );
                    finalizeBezierShape( trimmed, false );
                }
                else if( tool === ToolMode.PEN || tool === ToolMode.POLYGON )
                {
                    const trimmed : Array<{ x : number; y : number }> = [ ...polyPointsRef.current ];
                    polyPointsRef.current = [];
                    setPolyPoints( [] );
                    setPolyCursor( null );
                    finalizePolyShape( trimmed, tool === ToolMode.POLYGON );
                }
            }
            else if( event.key === "Escape" )
            {
                event.preventDefault();
                polyPointsRef.current = [];
                bezierAnchorsRef.current = [];
                setPolyPoints( [] );
                setPolyCursor( null );
                setBezierAnchors( [] );
                setBezierCursor( null );
                editor.dispatch( { type: SvgEditorActionType.SET_TOOL, tool: ToolMode.SELECT } );
                editor.dispatch( { type: SvgEditorActionType.SET_BEZIER_EDIT, nodeId: null } );
            }
        };

        document.addEventListener( "keydown", handleKeyDown );
        return () => document.removeEventListener( "keydown", handleKeyDown );
    }

    React.useEffect( registerDrawingKeyHandler, [ editor.state.tool, editor.state.bezierEditNodeId ] );

    ////////////////////////////////////////////////////////////////////////////////////////////
    // unified pointer-down: dispatch to the active tool's handler
    function onCanvasPointerDown( event : React.PointerEvent<HTMLDivElement> ) : void
    {
        // bezier edit mode intercepts all pointer events while active
        if( editor.state.bezierEditNodeId !== null )
        {
            handleBezierEditDown( event );
            return;
        }
        if( editor.state.tool === ToolMode.SELECT )  { handleSelectDown( event );              return; }
        if( editor.state.tool === ToolMode.TEXT )    { handleTextDown( event );                return; }
        if( editor.state.tool === ToolMode.SHAPE )   { handleShapeDown( event, false, false ); return; }
        if( editor.state.tool === ToolMode.ELLIPSE ) { handleShapeDown( event, true,  false ); return; }
        if( editor.state.tool === ToolMode.LINE )    { handleLineDown( event );                return; }
        if( editor.state.tool === ToolMode.BEZIER )  { handleBezierDown( event );              return; }
        if( editor.state.tool === ToolMode.PAN )     { handlePanDown( event );                 return; }
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // unified pointer-move: handle SHAPE/ELLIPSE rubber-band, LINE rubber-band, PAN scroll,
    // PEN/POLYGON live cursor tracking, and BEZIER cursor + anchor-drag
    function onCanvasPointerMove( event : React.PointerEvent<HTMLDivElement> ) : void
    {
        if( editor.state.tool === ToolMode.PAN ) { handlePanMove( event ); return; }

        // SELECT tool: update the live marquee-drag rect
        const marqueeStart : SvgCanvas.MarqueeStart | null = marqueeStartRef.current;
        if( marqueeStart !== null )
        {
            setMarqueePreview( marqueeRectFromDrag( event.clientX, event.clientY, marqueeStart ) );
        }

        // update live cursor for PEN/POLYGON polyline preview
        if( editor.state.tool === ToolMode.PEN || editor.state.tool === ToolMode.POLYGON )
        {
            const containerRect : DOMRect = event.currentTarget.getBoundingClientRect();
            const cursorPt : { x : number; y : number } = toDocPt( event.clientX, event.clientY, containerRect );
            setPolyCursor( cursorPt );
        }

        // BEZIER tool: update cursor and potentially upgrade the current anchor to smooth
        if( editor.state.tool === ToolMode.BEZIER )
        {
            handleBezierMove( event );
        }

        // BEZIER EDIT MODE: drag an anchor live
        if( editor.state.bezierEditNodeId !== null && bezierEditDragRef.current !== null )
        {
            handleBezierEditMove( event );
        }

        const start : SvgCanvas.DrawStart | null = drawStartRef.current;

        // update rubber-band line preview when in LINE mode
        if( start !== null && start.isLine )
        {
            const startRelX : number = start.clientX - start.containerRect.left;
            const startRelY : number = start.clientY - start.containerRect.top;
            const curRelX   : number = event.clientX - start.containerRect.left;
            const curRelY   : number = event.clientY - start.containerRect.top;
            setLinePreview( { x1: startRelX, y1: startRelY, x2: curRelX, y2: curRelY } );
        }

        const isDrawing : boolean = editor.state.tool === ToolMode.SHAPE || editor.state.tool === ToolMode.ELLIPSE;
        if( !isDrawing || start === null ) return;
        setPreview( previewFromDrag( event.clientX, event.clientY, start ) );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // unified pointer-up: end PAN scroll, finalize LINE draw, or finalize rubber-band draw
    function onCanvasPointerUp( event : React.PointerEvent<HTMLDivElement> ) : void
    {
        if( editor.state.tool === ToolMode.PAN )
        {
            panStartRef.current = null;
            event.currentTarget.releasePointerCapture( event.pointerId );
            return;
        }

        // SELECT tool: finalize a marquee drag — select whatever it touched, or (too small to count as
        // a real drag) fall back to a plain empty-canvas click, clearing the selection unless Shift is held
        const marqueeStart : SvgCanvas.MarqueeStart | null = marqueeStartRef.current;
        if( marqueeStart !== null )
        {
            marqueeStartRef.current = null;
            setMarqueePreview( null );
            event.currentTarget.releasePointerCapture( event.pointerId );

            const dragW : number = Math.abs( event.clientX - marqueeStart.clientX );
            const dragH : number = Math.abs( event.clientY - marqueeStart.clientY );
            if( dragW < 4 && dragH < 4 )
            {
                if( !marqueeStart.additive ) editor.dispatch( { type: SvgEditorActionType.CLEAR_SELECTION } );
                return;
            }

            const ptA : { x : number; y : number } = toDocPt( marqueeStart.clientX, marqueeStart.clientY, marqueeStart.containerRect );
            const ptB : { x : number; y : number } = toDocPt( event.clientX, event.clientY, marqueeStart.containerRect );
            const rect : Bounds = { minX: Math.min( ptA.x, ptB.x ), minY: Math.min( ptA.y, ptB.y ), maxX: Math.max( ptA.x, ptB.x ), maxY: Math.max( ptA.y, ptB.y ) };
            const hitIds : Array<string> = selectableObjects( props.page )
                .filter( ( object : SvgDocument.ObjectNode ) : boolean => rectIntersectsObject( rect, object ) )
                .map( ( object : SvgDocument.ObjectNode ) : string => object.id );

            const nextIds : Array<string> = marqueeStart.additive
                ? [ ...new Set( [ ...editor.state.selectedIds, ...hitIds ] ) ]
                : hitIds;
            editor.dispatch( { type: SvgEditorActionType.SELECT_OBJECTS, ids: nextIds } );
            return;
        }

        const start : SvgCanvas.DrawStart | null = drawStartRef.current;
        drawStartRef.current = null;
        setPreview( null );

        // BEZIER tool: release a point anchor (anchor already updated in handleBezierMove)
        if( editor.state.tool === ToolMode.BEZIER )
        {
            handleBezierUp( event );
            return;
        }

        // BEZIER EDIT MODE: commit anchor drag
        if( editor.state.bezierEditNodeId !== null )
        {
            handleBezierEditUp( event );
            return;
        }

        // LINE finalization — build a PATH shape from the two endpoints
        if( start !== null && start.isLine )
        {
            setLinePreview( null );
            const ptA    : { x : number; y : number } = toDocPt( start.clientX, start.clientY, start.containerRect );
            const ptB    : { x : number; y : number } = toDocPt( event.clientX, event.clientY, start.containerRect );
            const rawW   : number = Math.abs( ptB.x - ptA.x );
            const rawH   : number = Math.abs( ptB.y - ptA.y );
            if( rawW < 1 && rawH < 1 ) return;   // ignore accidental clicks
            const strokeW : number = DEFAULT_LINE_STROKE.width;
            const finalW  : number = Math.max( rawW, strokeW );
            const finalH  : number = Math.max( rawH, strokeW );
            const finalX  : number = Math.min( ptA.x, ptB.x ) - ( finalW - rawW ) / 2;
            const finalY  : number = Math.min( ptA.y, ptB.y ) - ( finalH - rawH ) / 2;
            const p1x     : number = ptA.x - finalX;
            const p1y     : number = ptA.y - finalY;
            const p2x     : number = ptB.x - finalX;
            const p2y     : number = ptB.y - finalY;
            const shape   : SvgDocument.ShapeNode = {
                ...DEFAULT_SHAPE,
                id: makeId(), name: "Line",
                shapeType: SvgDocument.ShapeType.PATH,
                pathData : `M ${ p1x } ${ p1y } L ${ p2x } ${ p2y }`,
                fill     : { kind: SvgDocument.FillKind.NONE },
                stroke   : DEFAULT_LINE_STROKE,
                transform: defaultTransform( finalX, finalY, finalW, finalH ),
            };
            const lineDoc : SvgDocument.Doc = addObject( props.doc, editor.state.activePage, editor.state.activeLayer, shape );
            editor.dispatch( { type: SvgEditorActionType.SET_DOC, doc: lineDoc } );
            editor.dispatch( { type: SvgEditorActionType.SELECT_OBJECTS, ids: [ shape.id ] } );
            editor.dispatch( { type: SvgEditorActionType.SET_TOOL, tool: ToolMode.SELECT } );
            return;
        }

        const isDrawing : boolean = editor.state.tool === ToolMode.SHAPE || editor.state.tool === ToolMode.ELLIPSE;
        if( !isDrawing || start === null ) return;

        // ignore tiny drags (< 4 px) — treat as an accidental click, not a draw
        const dragW : number = Math.abs( event.clientX - start.clientX );
        const dragH : number = Math.abs( event.clientY - start.clientY );
        if( dragW < 4 || dragH < 4 ) return;

        // convert the rubber-band corners to document points
        const ptA : { x : number; y : number } = toDocPt( start.clientX, start.clientY, start.containerRect );
        const ptB : { x : number; y : number } = toDocPt( event.clientX, event.clientY, start.containerRect );
        const docX : number = Math.min( ptA.x, ptB.x );
        const docY : number = Math.min( ptA.y, ptB.y );
        const docW : number = Math.abs( ptB.x - ptA.x );
        const docH : number = Math.abs( ptB.y - ptA.y );

        // build the shape node (rect or ellipse) and commit it to the doc
        const shapeType : SvgDocument.ShapeType = start.ellipse ? SvgDocument.ShapeType.ELLIPSE : SvgDocument.ShapeType.RECT;
        const shapeName : string = start.ellipse ? "Ellipse" : "Rectangle";
        const shape : SvgDocument.ShapeNode =
        {
            ...DEFAULT_SHAPE,
            id: makeId(), name: shapeName, shapeType,
            transform: defaultTransform( docX, docY, docW, docH ),
        };
        const nextDoc : SvgDocument.Doc = addObject( props.doc, editor.state.activePage, editor.state.activeLayer, shape );
        editor.dispatch( { type: SvgEditorActionType.SET_DOC, doc: nextDoc } );
        editor.dispatch( { type: SvgEditorActionType.SELECT_OBJECTS, ids: [ shape.id ] } );
        editor.dispatch( { type: SvgEditorActionType.SET_TOOL, tool: ToolMode.SELECT } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // unified click: dispatch to PEN/POLYGON point-placement or suppress deselect during BEZIER draw
    function onCanvasClick( event : React.MouseEvent<HTMLDivElement> ) : void
    {
        if( editor.state.tool === ToolMode.PEN || editor.state.tool === ToolMode.POLYGON )
        {
            handlePolyClick( event );
            return;
        }
        // BEZIER: anchor was already added in handleBezierDown; nothing extra needed here
        if( editor.state.tool === ToolMode.BEZIER ) return;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // unified double-click: dispatch to PEN/POLYGON path finalization, BEZIER finalization,
    // or SELECT-mode double-click on a PATH shape to enter bezier anchor-edit mode
    function onCanvasDoubleClick( event : React.MouseEvent<HTMLDivElement> ) : void
    {
        // in SELECT mode: double-click a PATH shape to enter bezier anchor-edit mode
        if( editor.state.tool === ToolMode.SELECT && editor.state.bezierEditNodeId === null )
        {
            // first try: find a PATH shape directly under the click
            const target : Element = event.target as Element;
            const owner : Element | null = target.closest( "[data-id]" );
            const id : string | null = owner !== null ? owner.getAttribute( "data-id" ) : null;
            let editId : string | null = null;
            if( id !== null && editor.state.doc !== null )
            {
                const node : SvgDocument.ObjectNode | undefined = findObject( editor.state.doc, id );
                if( node !== undefined && node.kind === SvgDocument.ObjectKind.SHAPE &&
                    ( node as SvgDocument.ShapeNode ).shapeType === SvgDocument.ShapeType.PATH )
                {
                    editId = id;
                }
            }
            // fallback: the double-click may have landed on the selection border/handles (InteractionOverlay)
            // rather than the path pixels — if exactly one PATH shape is selected, treat that as the target
            if( editId === null && editor.state.selectedIds.length === 1 && editor.state.doc !== null )
            {
                const selId : string = editor.state.selectedIds[ 0 ] ?? "";
                const selNode : SvgDocument.ObjectNode | undefined = findObject( editor.state.doc, selId );
                if( selNode !== undefined && selNode.kind === SvgDocument.ObjectKind.SHAPE &&
                    ( selNode as SvgDocument.ShapeNode ).shapeType === SvgDocument.ShapeType.PATH )
                {
                    editId = selId;
                }
            }
            if( editId !== null )
            {
                editor.dispatch( { type: SvgEditorActionType.SET_BEZIER_EDIT, nodeId: editId } );
                return;
            }
        }
        if( editor.state.tool === ToolMode.PEN || editor.state.tool === ToolMode.POLYGON )
        {
            handlePolyDoubleClick( event );
            return;
        }
        if( editor.state.tool === ToolMode.BEZIER )
        {
            handleBezierDoubleClick( event );
        }
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // build the SVG points attribute string for the in-progress polyline preview
    function polylinePointsAttr() : string
    {
        return polyPoints
            .map( ( p : { x : number; y : number } ) : string => `${ p.x * zoom },${ p.y * zoom }` )
            .join( " " );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    return  <Box onPointerDown={ onCanvasPointerDown }
                 onPointerMove={ onCanvasPointerMove }
                 onPointerUp={ onCanvasPointerUp }
                 onClick={ onCanvasClick }
                 onDoubleClick={ onCanvasDoubleClick }
                 sx={{ position: "relative", width: scaledWidth, height: scaledHeight, boxShadow: 3,
                       bgcolor: "background.paper", cursor: TOOL_CURSOR[ editor.state.tool ] }}>
                {/* the compiled page — the single rendering path (same output as export).
                    The SVG uses width/height="100%" so it fills the container at any zoom without needing
                    an external "& svg" CSS selector, which avoids the selection-box offset at zoom ≠ 1. */}
                <Box sx={{ position: "absolute", inset: 0 }} dangerouslySetInnerHTML={ { __html: svgMarkup } } />
                <InteractionOverlay doc={ props.doc } page={ props.page } />
                {/* rubber-band preview shown while drawing a shape */}
                { preview !== null &&
                    <Box sx={{ position: "absolute", left: preview.left, top: preview.top,
                               width: preview.width, height: preview.height,
                               border: "1.5px dashed", borderColor: "primary.main",
                               bgcolor: "primary.main", opacity: 0.12, pointerEvents: "none",
                               borderRadius: preview.ellipse ? "50%" : 0 }} /> }
                {/* SELECT tool: marquee-drag rect shown while dragging on empty canvas */}
                { marqueePreview !== null &&
                    <Box sx={{ position: "absolute", left: marqueePreview.left, top: marqueePreview.top,
                               width: marqueePreview.width, height: marqueePreview.height,
                               border: "1.5px dashed", borderColor: "primary.main",
                               bgcolor: "primary.main", opacity: 0.12, pointerEvents: "none" }} /> }
                {/* line rubber-band preview — a dashed SVG line overlaid on the canvas */}
                { linePreview !== null &&
                    <Box component="svg" sx={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }}>
                        <line x1={ linePreview.x1 } y1={ linePreview.y1 }
                              x2={ linePreview.x2 } y2={ linePreview.y2 }
                              stroke={ theme.palette.primary.main } strokeWidth={ 1.5 } strokeDasharray="5 3" />
                    </Box> }
                {/* polyline/polygon in-progress preview */}
                { polyCursor !== null && polyPoints.length > 0 &&
                    <Box component="svg" sx={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }}>
                        {/* already-committed segments */}
                        { polyPoints.length > 1 &&
                            <polyline
                                points={ polylinePointsAttr() }
                                stroke={ theme.palette.primary.main } strokeWidth={ 1.5 } fill="none" /> }
                        {/* live segment from last committed point to cursor */}
                        <line x1={ polyPoints[ polyPoints.length - 1 ].x * zoom }
                              y1={ polyPoints[ polyPoints.length - 1 ].y * zoom }
                              x2={ polyCursor.x * zoom }
                              y2={ polyCursor.y * zoom }
                              stroke={ theme.palette.primary.main } strokeWidth={ 1.5 } strokeDasharray="5 3" />
                        {/* vertex dots at each committed point */}
                        { polyPoints.map( ( p : { x : number; y : number }, index : number ) : JSX.Element =>
                            <circle key={ index } cx={ p.x * zoom } cy={ p.y * zoom } r={ 3 }
                                    fill={ theme.palette.primary.main } /> ) }
                    </Box> }
                {/* bezier draw tool in-progress preview */}
                { editor.state.tool === ToolMode.BEZIER && bezierAnchors.length > 0 &&
                    <Box component="svg" sx={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }}>
                        {/* committed segments — build path from placed anchors */}
                        { bezierAnchors.length > 1 &&
                            <path d={ buildBezierPathData(
                                bezierAnchors.map( ( a : BezierAnchor ) : BezierAnchor => ( {
                                    ...a,
                                    x: a.x * zoom,
                                    y: a.y * zoom,
                                    cpOutX: a.cpOutX !== null ? a.cpOutX * zoom : null,
                                    cpOutY: a.cpOutY !== null ? a.cpOutY * zoom : null,
                                } ) ),
                                false
                            ) } stroke={ theme.palette.primary.main } strokeWidth={ 1.5 } fill="none" /> }
                        {/* live segment from last anchor to cursor — curved when the last anchor has an exit handle */}
                        { bezierCursor !== null &&
                            <path d={ buildLiveSegmentPath() }
                                  stroke={ theme.palette.primary.main } strokeWidth={ 1.5 } fill="none" strokeDasharray="5 3" /> }
                        {/* anchor dots */}
                        { bezierAnchors.map( ( a : BezierAnchor, index : number ) : JSX.Element =>
                            <circle key={ index } cx={ a.x * zoom } cy={ a.y * zoom } r={ 4 }
                                    fill={ theme.palette.background.paper } stroke={ theme.palette.primary.main } strokeWidth={ 1.5 } /> ) }
                        {/* control handle lines and squares for the last anchor when dragging smooth */}
                        { renderBezierHandles() }
                    </Box> }
                {/* bezier edit mode anchor overlay */}
                { renderBezierEditOverlay() }
            </Box>;
}

export namespace SvgCanvas
{
    export interface Props
    {
        doc  : SvgDocument.Doc;
        page : SvgDocument.Page;
    }

    /** State captured at the start of a SHAPE/ELLIPSE/LINE drag: pointer origin + container rect + shape kind. */
    export interface DrawStart
    {
        clientX       : number;
        clientY       : number;
        containerRect : DOMRect;
        ellipse       : boolean;
        isLine        : boolean;
    }

    /** A rubber-band preview rect in px, relative to the canvas container. */
    export interface Preview
    {
        left    : number;
        top     : number;
        width   : number;
        height  : number;
        ellipse : boolean;
    }

    /** A rubber-band line preview in CSS px, relative to the canvas container. */
    export interface LinePreview
    {
        readonly x1 : number;
        readonly y1 : number;
        readonly x2 : number;
        readonly y2 : number;
    }

    /** State captured at the start of a SELECT-tool marquee drag (empty-canvas mousedown). */
    export interface MarqueeStart
    {
        clientX       : number;
        clientY       : number;
        containerRect : DOMRect;
        additive      : boolean;   // Shift was held — union with the existing selection instead of replacing it
    }

    /** The live marquee-drag rect in px, relative to the canvas container. */
    export interface MarqueeRect
    {
        left   : number;
        top    : number;
        width  : number;
        height : number;
    }
}

export default SvgCanvas;
