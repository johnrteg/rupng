//
import React from "react";
import { JSX } from "react";

import { Box, useTheme, Theme } from "@mui/material";

import { SvgDocument } from "@repo/api";

import { SvgEditorContext, SvgEditorContextValue } from "@widgets/svg/editor/SvgEditorContext";
import { SvgEditorActionType, DEFAULT_TEXT_STYLE } from "@widgets/svg/editor/SvgEditorModel";
import { findObject, replaceObject } from "@widgets/svg/editor/SvgDocOps";

// ── Module-level types + constants ─────────────────────────────────────────

/** Visual + behavioural spec for one resize handle on a selection box. */
interface HandleDef
{
    readonly key     : string;
    readonly leftPct : string;    // CSS left percentage for absolute positioning inside the selection box
    readonly topPct  : string;    // CSS top percentage
    readonly cursor  : string;    // directional CSS resize cursor
    readonly anchorX : number;    // 0 = left edge moves, 0.5 = no x/width change, 1 = right edge moves
    readonly anchorY : number;    // 0 = top edge moves,  0.5 = no y/height change, 1 = bottom edge
}

/** State captured when a resize handle drag begins (pointer is captured on the handle element). */
interface HandleDrag
{
    readonly nodeId         : string;
    readonly anchorX        : number;
    readonly anchorY        : number;
    readonly startX         : number;
    readonly startY         : number;
    readonly startTransform : SvgDocument.Transform;
    readonly aspectLocked   : boolean;   // true when the image node has aspectLocked set
}

/** State captured when a crop handle drag begins. */
interface CropDrag
{
    readonly nodeId      : string;
    readonly anchorX     : number;
    readonly anchorY     : number;
    readonly startX      : number;
    readonly startY      : number;
    readonly startCrop   : SvgDocument.CropRect;
    readonly nodeWidth   : number;   // pt — upper bound for crop clamping
    readonly nodeHeight  : number;
    readonly preDragDoc  : SvgDocument.Doc;  // snapshot for a single clean undo entry on drag end
}

/** State captured when a rotation pip drag begins (pointer captured on the pip). */
interface RotateDrag
{
    readonly nodeId        : string;
    readonly centerX       : number;       // object centre in screen (clientX) coords
    readonly centerY       : number;
    readonly startAngle    : number;       // angle (radians) from centre to mouse at drag start
    readonly startRotation : number;       // node.transform.rotation at drag start (degrees)
    readonly preDragDoc    : SvgDocument.Doc;
}

/** The 8 corner + edge-midpoint resize handles, each with a directional resize cursor. */
const HANDLE_DEFS : Array<HandleDef> =
[
    { key: "tl", leftPct: "0%",   topPct: "0%",   cursor: "nw-resize", anchorX: 0,   anchorY: 0   },
    { key: "tc", leftPct: "50%",  topPct: "0%",   cursor: "n-resize",  anchorX: 0.5, anchorY: 0   },
    { key: "tr", leftPct: "100%", topPct: "0%",   cursor: "ne-resize", anchorX: 1,   anchorY: 0   },
    { key: "ml", leftPct: "0%",   topPct: "50%",  cursor: "w-resize",  anchorX: 0,   anchorY: 0.5 },
    { key: "mr", leftPct: "100%", topPct: "50%",  cursor: "e-resize",  anchorX: 1,   anchorY: 0.5 },
    { key: "bl", leftPct: "0%",   topPct: "100%", cursor: "sw-resize", anchorX: 0,   anchorY: 1   },
    { key: "bc", leftPct: "50%",  topPct: "100%", cursor: "s-resize",  anchorX: 0.5, anchorY: 1   },
    { key: "br", leftPct: "100%", topPct: "100%", cursor: "se-resize", anchorX: 1,   anchorY: 1   },
];

/** CSS resize cursors ordered clockwise from north, used to rotate handle cursors with the object. */
const RESIZE_CURSORS : Array<string> =
[
    "n-resize", "ne-resize", "e-resize", "se-resize",
    "s-resize", "sw-resize", "w-resize", "nw-resize",
];
/** Base index (0 = north, clockwise) for each handle cursor at 0° object rotation. */
const CURSOR_BASE_INDEX : Partial<Record<string, number>> =
{
    "n-resize": 0, "ne-resize": 1, "e-resize": 2, "se-resize": 3,
    "s-resize": 4, "sw-resize": 5, "w-resize": 6, "nw-resize": 7,
};

/** Return the correct CSS resize cursor for a handle whose base direction is baseCursor when the
 *  object is rotated by rotation degrees (CW positive). Steps in 45° increments around the ring. */
function rotatedHandleCursor( baseCursor : string, rotation : number ) : string
{
    const base      : number = CURSOR_BASE_INDEX[ baseCursor ] ?? 0;
    const steps     : number = Math.round( rotation / 45 );
    const effective : number = ( ( base + steps ) % 8 + 8 ) % 8;
    return RESIZE_CURSORS[ effective ] ?? baseCursor;
}

const HANDLE_PX     : number = 6;   // handle square side length (CSS px)
const RESIZE_MIN_PT : number = 1;   // minimum object width / height during resize (doc points)
const CROP_MIN_PT   : number = 1;   // minimum crop rect dimension

// ── Component ──────────────────────────────────────────────────────────────

//
// InteractionOverlay — the transparent DOM layer over the compiled SVG.
// Draws selection boxes with 8 per-handle directional-cursor resize handles and a rotation pip.
// Implements drag-to-move, drag-to-resize (each handle moves the appropriate edge(s) of the
// object transform), aspect-locked resize for images, and a crop-rect overlay with 8 draggable
// crop handles when the editor is in crop mode for an image node.
// Coordinate conversion: CSS px ÷ zoom → doc points.
//
export function InteractionOverlay( props : InteractionOverlay.Props ) : JSX.Element
{
    const editor : SvgEditorContextValue = React.useContext( SvgEditorContext );
    const theme  : Theme = useTheme();

    // refs give pointer handlers the latest doc + drag state without stale closure issues
    const docRef : React.MutableRefObject<SvgDocument.Doc | null> = React.useRef<SvgDocument.Doc | null>( editor.state.doc );
    docRef.current = editor.state.doc;
    const dragRef       : React.MutableRefObject<InteractionOverlay.Drag | null> = React.useRef<InteractionOverlay.Drag | null>( null );
    const handleDragRef : React.MutableRefObject<HandleDrag | null>              = React.useRef<HandleDrag | null>( null );
    const cropDragRef   : React.MutableRefObject<CropDrag | null>               = React.useRef<CropDrag | null>( null );
    const rotateDragRef : React.MutableRefObject<RotateDrag | null>             = React.useRef<RotateDrag | null>( null );
    // ref to the overlay container — used to convert node coords to screen coords for rotation
    const overlayRef    : React.MutableRefObject<HTMLDivElement | null>         = React.useRef<HTMLDivElement | null>( null );

    const zoom : number = editor.state.zoom;

    // id of the text node currently in inline-edit mode — lives in the editor context so SvgCanvas
    // can exclude that node from the compiled SVG (prevents double-rendering behind the textarea)
    const editingTextId : string | null = editor.state.editingNodeId;
    // ref to the live textarea element so onChange can measure its scrollHeight for auto-grow
    const textareaRef : React.MutableRefObject<HTMLTextAreaElement | null> = React.useRef<HTMLTextAreaElement | null>( null );

    // the objects currently selected that still exist in the doc
    const selected : Array<SvgDocument.ObjectNode> = editor.state.doc === null
        ? []
        : editor.state.selectedIds
            .map( ( id : string ) : SvgDocument.ObjectNode | undefined => findObject( editor.state.doc as SvgDocument.Doc, id ) )
            .filter( ( node : SvgDocument.ObjectNode | undefined ) : node is SvgDocument.ObjectNode => node !== undefined );

    // resolve the node being edited (undefined when not editing or the node was deleted)
    const editingNode : SvgDocument.ObjectNode | undefined = editingTextId !== null && editor.state.doc !== null
        ? findObject( editor.state.doc, editingTextId )
        : undefined;

    ////////////////////////////////////////////////////////////////////////////////////////////
    // ── Move drag ─────────────────────────────────────────────────────────

    // begin a move drag — capture the pointer and snapshot each selected object's start position (pt)
    function onBoxPointerDown( event : React.PointerEvent<HTMLDivElement> ) : void
    {
        event.preventDefault();
        event.stopPropagation();
        event.currentTarget.setPointerCapture( event.pointerId );
        const positions : Array<InteractionOverlay.StartPos> = selected.map(
            ( node : SvgDocument.ObjectNode ) : InteractionOverlay.StartPos => ( { id: node.id, x: node.transform.x, y: node.transform.y } )
        );
        dragRef.current = { startX: event.clientX, startY: event.clientY, positions };
    }

    // during a move drag — translate the pointer delta (px → pt) onto every dragged object and commit
    function onBoxPointerMove( event : React.PointerEvent<HTMLDivElement> ) : void
    {
        const drag : InteractionOverlay.Drag | null = dragRef.current;
        const doc  : SvgDocument.Doc | null          = docRef.current;
        if( drag === null || doc === null ) return;

        const deltaX : number = ( event.clientX - drag.startX ) / zoom;
        const deltaY : number = ( event.clientY - drag.startY ) / zoom;

        let nextDoc : SvgDocument.Doc = doc;
        for( const start of drag.positions )
        {
            const node : SvgDocument.ObjectNode | undefined = findObject( nextDoc, start.id );
            if( node === undefined ) continue;
            const transform : SvgDocument.Transform = { ...node.transform, x: start.x + deltaX, y: start.y + deltaY };
            nextDoc = replaceObject( nextDoc, start.id, { ...node, transform } );
        }
        editor.dispatch( { type: SvgEditorActionType.SET_DOC, doc: nextDoc } );
    }

    // end a move drag
    function onBoxPointerUp( event : React.PointerEvent<HTMLDivElement> ) : void
    {
        event.currentTarget.releasePointerCapture( event.pointerId );
        dragRef.current = null;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // ── Resize drag ───────────────────────────────────────────────────────

    // begin a resize drag — capture pointer on the handle and snapshot the object's transform
    function onHandlePointerDown( event : React.PointerEvent<HTMLDivElement>, nodeId : string, anchorX : number, anchorY : number ) : void
    {
        event.stopPropagation();
        event.currentTarget.setPointerCapture( event.pointerId );
        const doc : SvgDocument.Doc | null = docRef.current;
        if( doc === null ) return;
        const node : SvgDocument.ObjectNode | undefined = findObject( doc, nodeId );
        if( node === undefined ) return;
        const isAspectLocked : boolean = node.kind === SvgDocument.ObjectKind.IMAGE && ( node as SvgDocument.ImageNode ).aspectLocked;
        handleDragRef.current = { nodeId, anchorX, anchorY, startX: event.clientX, startY: event.clientY, startTransform: { ...node.transform }, aspectLocked: isAspectLocked };
    }

    // during a resize drag — project the pointer delta into the object's rotated local frame, derive new
    // dimensions in local space, then shift (x, y) so the anchor corner stays fixed in doc space
    function onHandlePointerMove( event : React.PointerEvent<HTMLDivElement> ) : void
    {
        const drag : HandleDrag | null      = handleDragRef.current;
        const doc  : SvgDocument.Doc | null = docRef.current;
        if( drag === null || doc === null ) return;

        const node : SvgDocument.ObjectNode | undefined = findObject( doc, drag.nodeId );
        if( node === undefined ) return;

        // project screen-space delta into the object's local coordinate frame (un-rotate by θ)
        const t     : SvgDocument.Transform = drag.startTransform;
        const θRad  : number = ( t.rotation * Math.PI ) / 180;
        const cosθ  : number = Math.cos( θRad );
        const sinθ  : number = Math.sin( θRad );
        const rawDx : number = ( event.clientX - drag.startX ) / zoom;
        const rawDy : number = ( event.clientY - drag.startY ) / zoom;
        const dx    : number = rawDx * cosθ + rawDy * sinθ;   // local X delta
        const dy    : number = -rawDx * sinθ + rawDy * cosθ;  // local Y delta

        // apply anchor logic in local space to get new dimensions
        // anchorX=0 → left edge moves (width shrinks); anchorX=1 → right edge (width grows)
        let newW : number = t.width;
        let newH : number = t.height;
        if( drag.anchorX === 0 ) { newW = Math.max( RESIZE_MIN_PT, t.width  - dx ); }
        if( drag.anchorX === 1 ) { newW = Math.max( RESIZE_MIN_PT, t.width  + dx ); }
        if( drag.anchorY === 0 ) { newH = Math.max( RESIZE_MIN_PT, t.height - dy ); }
        if( drag.anchorY === 1 ) { newH = Math.max( RESIZE_MIN_PT, t.height + dy ); }

        // aspect lock for image nodes — dominant axis drives the other; position correction below handles re-anchoring
        const isCorner : boolean = drag.anchorX !== 0.5 && drag.anchorY !== 0.5;
        if( drag.aspectLocked && isCorner && t.width > 0 && t.height > 0 )
        {
            const aspect       : number = t.width / t.height;
            const widthChange  : number = Math.abs( newW / t.width  - 1 );
            const heightChange : number = Math.abs( newH / t.height - 1 );
            if( widthChange >= heightChange )
            {
                newH = Math.max( RESIZE_MIN_PT, newW / aspect );
            }
            else
            {
                newW = Math.max( RESIZE_MIN_PT, newH * aspect );
            }
        }

        // compute the anchor (fixed) corner's doc-space position from the start transform —
        // this point must not move in world space during the drag regardless of object rotation
        const fixedLocalX : number = drag.anchorX === 0 ? t.width  : drag.anchorX === 1 ? 0 : t.width  / 2;
        const fixedLocalY : number = drag.anchorY === 0 ? t.height : drag.anchorY === 1 ? 0 : t.height / 2;
        const oldCx : number = t.x + t.width  / 2;
        const oldCy : number = t.y + t.height / 2;
        const fixedDocX : number = oldCx + ( fixedLocalX - t.width  / 2 ) * cosθ - ( fixedLocalY - t.height / 2 ) * sinθ;
        const fixedDocY : number = oldCy + ( fixedLocalX - t.width  / 2 ) * sinθ + ( fixedLocalY - t.height / 2 ) * cosθ;

        // where the same corner sits in the new-sized transform (tentatively keeping t.x/y unchanged)
        const newFixedLocalX : number = drag.anchorX === 0 ? newW : drag.anchorX === 1 ? 0 : newW / 2;
        const newFixedLocalY : number = drag.anchorY === 0 ? newH : drag.anchorY === 1 ? 0 : newH / 2;
        const tentativeCx    : number = t.x + newW / 2;
        const tentativeCy    : number = t.y + newH / 2;
        const newFixedDocX   : number = tentativeCx + ( newFixedLocalX - newW / 2 ) * cosθ - ( newFixedLocalY - newH / 2 ) * sinθ;
        const newFixedDocY   : number = tentativeCy + ( newFixedLocalX - newW / 2 ) * sinθ + ( newFixedLocalY - newH / 2 ) * cosθ;

        // shift (x, y) to bring the anchor corner back to its original doc-space position
        const newX : number = t.x + ( fixedDocX - newFixedDocX );
        const newY : number = t.y + ( fixedDocY - newFixedDocY );

        const transform : SvgDocument.Transform = { ...t, x: newX, y: newY, width: newW, height: newH };
        const nextDoc : SvgDocument.Doc = replaceObject( doc, drag.nodeId, { ...node, transform } );
        editor.dispatch( { type: SvgEditorActionType.SET_DOC, doc: nextDoc } );
    }

    // end a resize drag
    function onHandlePointerUp( event : React.PointerEvent<HTMLDivElement> ) : void
    {
        event.currentTarget.releasePointerCapture( event.pointerId );
        handleDragRef.current = null;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // ── Crop drag ─────────────────────────────────────────────────────────

    // begin a crop-handle drag — snapshot the current crop rect + the pre-drag doc for undo
    function onCropHandlePointerDown( event : React.PointerEvent<HTMLDivElement>, nodeId : string, anchorX : number, anchorY : number ) : void
    {
        event.stopPropagation();
        event.currentTarget.setPointerCapture( event.pointerId );
        const doc : SvgDocument.Doc | null = docRef.current;
        if( doc === null ) return;
        const node : SvgDocument.ObjectNode | undefined = findObject( doc, nodeId );
        if( node === undefined || node.kind !== SvgDocument.ObjectKind.IMAGE ) return;
        const imageNode : SvgDocument.ImageNode = node as SvgDocument.ImageNode;
        const startCrop : SvgDocument.CropRect = imageNode.crop ?? {
            x: 0, y: 0, width: node.transform.width, height: node.transform.height,
        };
        cropDragRef.current = {
            nodeId, anchorX, anchorY,
            startX: event.clientX, startY: event.clientY,
            startCrop,
            nodeWidth: node.transform.width, nodeHeight: node.transform.height,
            preDragDoc: doc,
        };
    }

    // during a crop-handle drag — adjust the crop rect edges and clamp to the node bounds
    function onCropHandlePointerMove( event : React.PointerEvent<HTMLDivElement> ) : void
    {
        const drag : CropDrag | null        = cropDragRef.current;
        const doc  : SvgDocument.Doc | null = docRef.current;
        if( drag === null || doc === null ) return;
        const node : SvgDocument.ObjectNode | undefined = findObject( doc, drag.nodeId );
        if( node === undefined || node.kind !== SvgDocument.ObjectKind.IMAGE ) return;

        const dx : number = ( event.clientX - drag.startX ) / zoom;
        const dy : number = ( event.clientY - drag.startY ) / zoom;
        const sc : SvgDocument.CropRect = drag.startCrop;

        let cropX : number = sc.x;
        let cropY : number = sc.y;
        let cropW : number = sc.width;
        let cropH : number = sc.height;

        // move edges that correspond to the dragged handle's anchor position
        if( drag.anchorX === 0 ) { cropX = sc.x + dx; cropW = sc.width - dx; }
        if( drag.anchorX === 1 ) { cropW = sc.width + dx; }
        if( drag.anchorY === 0 ) { cropY = sc.y + dy; cropH = sc.height - dy; }
        if( drag.anchorY === 1 ) { cropH = sc.height + dy; }

        // clamp so the crop stays inside the node bounds
        cropX = Math.max( 0, Math.min( drag.nodeWidth  - CROP_MIN_PT, cropX ) );
        cropY = Math.max( 0, Math.min( drag.nodeHeight - CROP_MIN_PT, cropY ) );
        cropW = Math.max( CROP_MIN_PT, Math.min( drag.nodeWidth  - cropX, cropW ) );
        cropH = Math.max( CROP_MIN_PT, Math.min( drag.nodeHeight - cropY, cropH ) );

        const updatedNode : SvgDocument.ImageNode = { ...( node as SvgDocument.ImageNode ), crop: { x: cropX, y: cropY, width: cropW, height: cropH } };
        const nextDoc : SvgDocument.Doc = replaceObject( doc, drag.nodeId, updatedNode );
        // live update during drag — no undo snapshot yet (committed on pointer-up)
        editor.dispatch( { type: SvgEditorActionType.UPDATE_DOC_LIVE, doc: nextDoc } );
    }

    // end a crop-handle drag — commit one undo snapshot for the entire drag (preDragDoc → finalDoc)
    function onCropHandlePointerUp( event : React.PointerEvent<HTMLDivElement> ) : void
    {
        event.currentTarget.releasePointerCapture( event.pointerId );
        const drag : CropDrag | null        = cropDragRef.current;
        cropDragRef.current = null;
        const finalDoc : SvgDocument.Doc | null = docRef.current;
        if( drag !== null && finalDoc !== null )
            editor.dispatch( { type: SvgEditorActionType.COMMIT_DOC, snapshot: drag.preDragDoc, doc: finalDoc } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // ── Rotation ──────────────────────────────────────────────────────────

    // begin a rotation drag: capture the pointer on the pip, snapshot the object's current rotation
    // and record the centre + starting angle so move events can compute delta rotation
    function onRotateDown( event : React.PointerEvent<HTMLDivElement>, nodeId : string ) : void
    {
        event.stopPropagation();
        const doc : SvgDocument.Doc | null = docRef.current;
        if( doc === null ) return;
        const node : SvgDocument.ObjectNode | undefined = findObject( doc, nodeId );
        if( node === undefined ) return;
        const rect : DOMRect | undefined = overlayRef.current?.getBoundingClientRect();
        if( rect === undefined ) return;
        event.currentTarget.setPointerCapture( event.pointerId );
        const centerX : number = rect.left + ( node.transform.x + node.transform.width  / 2 ) * zoom;
        const centerY : number = rect.top  + ( node.transform.y + node.transform.height / 2 ) * zoom;
        const startAngle : number = Math.atan2( event.clientY - centerY, event.clientX - centerX );
        rotateDragRef.current = { nodeId, centerX, centerY, startAngle, startRotation: node.transform.rotation, preDragDoc: doc };
    }

    // during a rotation drag: compute the angle delta and apply it to the node's rotation live;
    // the delta is normalized to (-180, 180] to avoid jumps when atan2 wraps at ±π, and the
    // resulting angle is kept in [-180, 180) so rotations read as small negatives rather than 270°+
    function onRotateMove( event : React.PointerEvent<HTMLDivElement> ) : void
    {
        const drag : RotateDrag | null      = rotateDragRef.current;
        const doc  : SvgDocument.Doc | null = docRef.current;
        if( drag === null || doc === null ) return;
        const node : SvgDocument.ObjectNode | undefined = findObject( doc, drag.nodeId );
        if( node === undefined ) return;
        const currentAngle  : number = Math.atan2( event.clientY - drag.centerY, event.clientX - drag.centerX );
        // normalize the per-frame delta so a fast drag crossing ±180° doesn't snap
        const rawDeltaRad   : number = currentAngle - drag.startAngle;
        const normDeltaRad  : number = ( ( rawDeltaRad + Math.PI ) % ( 2 * Math.PI ) + 2 * Math.PI ) % ( 2 * Math.PI ) - Math.PI;
        const deltaAngleDeg : number = normDeltaRad * ( 180 / Math.PI );
        const raw           : number = drag.startRotation + deltaAngleDeg;
        // normalize result to [-180, 180) — 270° becomes -90°, etc.
        const newRotation   : number = ( ( raw + 180 ) % 360 + 360 ) % 360 - 180;
        const transform : SvgDocument.Transform = { ...node.transform, rotation: newRotation };
        const nextDoc   : SvgDocument.Doc        = replaceObject( doc, drag.nodeId, { ...node, transform } );
        editor.dispatch( { type: SvgEditorActionType.UPDATE_DOC_LIVE, doc: nextDoc } );
    }

    // end a rotation drag: release pointer capture and commit one undo snapshot for the full drag
    function onRotateUp( event : React.PointerEvent<HTMLDivElement> ) : void
    {
        event.currentTarget.releasePointerCapture( event.pointerId );
        const drag     : RotateDrag | null       = rotateDragRef.current;
        rotateDragRef.current = null;
        const finalDoc : SvgDocument.Doc | null  = docRef.current;
        if( drag !== null && finalDoc !== null )
            editor.dispatch( { type: SvgEditorActionType.COMMIT_DOC, snapshot: drag.preDragDoc, doc: finalDoc } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // ── Text inline editing ───────────────────────────────────────────────

    // double-click on a text object's selection box → switch to inline text edit mode
    function onBoxDoubleClick( event : React.MouseEvent<HTMLDivElement>, node : SvgDocument.ObjectNode ) : void
    {
        if( node.kind !== SvgDocument.ObjectKind.TEXT ) return;
        event.stopPropagation();
        editor.dispatch( { type: SvgEditorActionType.SET_EDITING_NODE, nodeId: node.id } );
    }

    // write the edited text back into the first span (preserving its style) and leave edit mode;
    // newHeight (in doc points) is applied when the textarea measured a larger scrollHeight
    function commitTextContent( node : SvgDocument.TextNode, text : string, newHeight ?: number ) : void
    {
        const doc : SvgDocument.Doc | null = docRef.current;
        if( doc === null ) return;
        const style     : SvgDocument.TextStyle = node.content[ 0 ]?.style ?? DEFAULT_TEXT_STYLE;
        const transform : SvgDocument.Transform = newHeight !== undefined
            ? { ...node.transform, height: newHeight }
            : node.transform;
        const updated   : SvgDocument.TextNode = { ...node, content: [ { text, style } ], transform };
        const nextDoc   : SvgDocument.Doc = replaceObject( doc, node.id, updated );
        editor.dispatch( { type: SvgEditorActionType.SET_DOC, doc: nextDoc } );
        editor.dispatch( { type: SvgEditorActionType.SET_EDITING_NODE, nodeId: null } );
    }

    // blur on the textarea → commit the current value + final measured height
    function onTextEditBlur( event : React.FocusEvent<HTMLTextAreaElement> ) : void
    {
        if( editingTextId === null || docRef.current === null ) return;
        const node : SvgDocument.ObjectNode | undefined = findObject( docRef.current, editingTextId );
        if( node === undefined || node.kind !== SvgDocument.ObjectKind.TEXT ) return;
        const height : number = event.target.scrollHeight / zoom;
        commitTextContent( node, event.target.value, height );
    }

    // Escape cancels the edit without committing; other keys pass through to the textarea normally
    function onTextEditKeyDown( event : React.KeyboardEvent<HTMLTextAreaElement> ) : void
    {
        if( event.key === "Escape" ) editor.dispatch( { type: SvgEditorActionType.SET_EDITING_NODE, nodeId: null } );
    }

    // auto-size the textarea to fit its content height and update the node's transform in the doc so
    // the selection box tracks the growing text live as the user types
    function onTextEditChange( event : React.ChangeEvent<HTMLTextAreaElement> ) : void
    {
        const el  : HTMLTextAreaElement = event.target;
        // reset to auto so shrinking text can also reduce the height, then re-measure
        el.style.height = "auto";
        el.style.height = `${ el.scrollHeight }px`;
        const doc : SvgDocument.Doc | null = docRef.current;
        if( doc === null || editingTextId === null ) return;
        const node : SvgDocument.ObjectNode | undefined = findObject( doc, editingTextId );
        if( node === undefined || node.kind !== SvgDocument.ObjectKind.TEXT ) return;
        const newHeight : number = el.scrollHeight / zoom;
        const transform : SvgDocument.Transform = { ...node.transform, height: newHeight };
        const nextDoc   : SvgDocument.Doc = replaceObject( doc, editingTextId, { ...node, transform } );
        editor.dispatch( { type: SvgEditorActionType.SET_DOC, doc: nextDoc } );
    }

    // on initial focus: auto-size to the existing content (the stored height may be too small)
    function onTextEditFocus( event : React.FocusEvent<HTMLTextAreaElement> ) : void
    {
        const el : HTMLTextAreaElement = event.target;
        el.style.height = "auto";
        el.style.height = `${ el.scrollHeight }px`;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // ── Render helpers ────────────────────────────────────────────────────

    // one resize handle square — cursor direction rotates with the object so handles are always legible
    function renderHandle( def : HandleDef, nodeId : string, rotation : number ) : JSX.Element
    {
        return  <Box key={ def.key }
                     onPointerDown={ ( event : React.PointerEvent<HTMLDivElement> ) : void => onHandlePointerDown( event, nodeId, def.anchorX, def.anchorY ) }
                     onPointerMove={ onHandlePointerMove }
                     onPointerUp={ onHandlePointerUp }
                     sx={{ position: "absolute", left: def.leftPct, top: def.topPct,
                           width: HANDLE_PX, height: HANDLE_PX,
                           transform: "translate(-50%, -50%)",
                           bgcolor: "background.paper",
                           border: `1px solid ${ theme.palette.primary.main }`,
                           pointerEvents: "auto",
                           cursor: rotatedHandleCursor( def.cursor, rotation ) }} />;
    }

    // all 8 resize handles for one selected object, with cursors rotated to match the object's rotation
    function renderHandles( node : SvgDocument.ObjectNode ) : Array<JSX.Element>
    {
        return HANDLE_DEFS.map( ( def : HandleDef ) : JSX.Element => renderHandle( def, node.id, node.transform.rotation ) );
    }

    // the selection box (border + handles + rotation pip) for one selected object;
    // the outer box is CSS-rotated about its own centre to match the SVG transform.rotate() on the object
    function selectionBox( node : SvgDocument.ObjectNode ) : JSX.Element
    {
        const left     : number = node.transform.x      * zoom;
        const top      : number = node.transform.y      * zoom;
        const width    : number = node.transform.width  * zoom;
        const height   : number = node.transform.height * zoom;
        const rotation : number = node.transform.rotation;
        return  <Box key={ node.id }
                     sx={{ position: "absolute", left, top, width, height,
                           transform: `rotate(${ rotation }deg)`, transformOrigin: "center center",
                           pointerEvents: "none" }}>
                    {/* draggable interior + selection border; double-click enters text edit mode */}
                    <Box onPointerDown={ onBoxPointerDown } onPointerMove={ onBoxPointerMove } onPointerUp={ onBoxPointerUp }
                         onDoubleClick={ ( event : React.MouseEvent<HTMLDivElement> ) : void => onBoxDoubleClick( event, node ) }
                         sx={{ position: "absolute", inset: 0, border: `1px solid ${ theme.palette.primary.main }`, pointerEvents: "auto", cursor: "move" }} />
                    {/* rotation connector line + pip */}
                    <Box sx={{ position: "absolute", left: "50%", top: -20, width: "1px", height: 20, bgcolor: "primary.main", transform: "translateX(-50%)", pointerEvents: "none" }} />
                    <Box onPointerDown={ ( event : React.PointerEvent<HTMLDivElement> ) : void => onRotateDown( event, node.id ) }
                         onPointerMove={ onRotateMove }
                         onPointerUp={ onRotateUp }
                         sx={{ position: "absolute", left: "50%", top: -20, width: 8, height: 8, borderRadius: "50%",
                               bgcolor: "primary.main", transform: "translate(-50%, -50%)", pointerEvents: "auto", cursor: "grab" }} />
                    { renderHandles( node ) }
                </Box>;
    }

    // one crop handle square at an absolute position within the node bounding box
    function cropHandle( def : HandleDef, nodeId : string, cropLeft : number, cropTop : number, cropWidth : number, cropHeight : number ) : JSX.Element
    {
        const handleLeft : number = cropLeft + ( def.anchorX === 0 ? 0 : def.anchorX === 0.5 ? cropWidth  / 2 : cropWidth  );
        const handleTop  : number = cropTop  + ( def.anchorY === 0 ? 0 : def.anchorY === 0.5 ? cropHeight / 2 : cropHeight );
        return  <Box key={ def.key }
                     onPointerDown={ ( event : React.PointerEvent<HTMLDivElement> ) : void => onCropHandlePointerDown( event, nodeId, def.anchorX, def.anchorY ) }
                     onPointerMove={ onCropHandlePointerMove }
                     onPointerUp={ onCropHandlePointerUp }
                     sx={{ position: "absolute", left: handleLeft, top: handleTop,
                           width: HANDLE_PX + 2, height: HANDLE_PX + 2,
                           transform: "translate(-50%, -50%)",
                           bgcolor: "background.paper",
                           border: "1px solid white",
                           pointerEvents: "auto",
                           cursor: def.cursor }} />;
    }

    // crop mode overlay: dim the masked-out region, outline the crop rect, and draw 8 crop handles;
    // uses a box-shadow spread to create the dim effect around the crop rect (overflow:hidden clips it)
    function cropBox( node : SvgDocument.ObjectNode ) : JSX.Element
    {
        if( node.kind !== SvgDocument.ObjectKind.IMAGE )
            return selectionBox( node );

        const imageNode : SvgDocument.ImageNode = node as SvgDocument.ImageNode;
        const crop : SvgDocument.CropRect = imageNode.crop ?? {
            x: 0, y: 0, width: node.transform.width, height: node.transform.height,
        };

        const boxLeft   : number = node.transform.x      * zoom;
        const boxTop    : number = node.transform.y      * zoom;
        const boxWidth  : number = node.transform.width  * zoom;
        const boxHeight : number = node.transform.height * zoom;
        const cropLeft  : number = crop.x      * zoom;
        const cropTop   : number = crop.y      * zoom;
        const cropWidth : number = crop.width  * zoom;
        const cropHeight : number = crop.height * zoom;

        return  <Box key={ node.id }
                     sx={{ position: "absolute", left: boxLeft, top: boxTop, width: boxWidth, height: boxHeight,
                           overflow: "hidden", pointerEvents: "none" }}>
                    {/* crop rect — box-shadow spread dims the region outside the crop */}
                    <Box sx={{ position: "absolute", left: cropLeft, top: cropTop, width: cropWidth, height: cropHeight,
                               boxShadow: "0 0 0 9999px rgba(0,0,0,0.45)",
                               border: "2px solid white",
                               pointerEvents: "none" }} />
                    { HANDLE_DEFS.map( ( def : HandleDef ) : JSX.Element => cropHandle( def, node.id, cropLeft, cropTop, cropWidth, cropHeight ) ) }
                </Box>;
    }

    // floating textarea overlay aligned to the text node — lets the user edit content inline
    function textEditOverlay( node : SvgDocument.ObjectNode ) : JSX.Element | null
    {
        if( node.kind !== SvgDocument.ObjectKind.TEXT ) return null;
        const spans      : Array<string>         = node.content.map( ( span : SvgDocument.TextSpan ) : string => span.text );
        const textValue  : string                = spans.join( "" );
        const textStyle  : SvgDocument.TextStyle = node.content[ 0 ]?.style ?? DEFAULT_TEXT_STYLE;
        const left   : number = node.transform.x      * zoom;
        const top    : number = node.transform.y      * zoom;
        const width  : number = node.transform.width  * zoom;
        const height : number = node.transform.height * zoom;
        return  <textarea
                    ref={ textareaRef }
                    autoFocus
                    defaultValue={ textValue }
                    onBlur={ onTextEditBlur }
                    onFocus={ onTextEditFocus }
                    onChange={ onTextEditChange }
                    onKeyDown={ onTextEditKeyDown }
                    style={{
                        position     : "absolute",
                        left, top, width, height,
                        fontFamily   : String( textStyle.fontFamily ),
                        fontSize     : `${ textStyle.fontSize * zoom }px`,
                        lineHeight   : textStyle.lineSpacing ?? 1.2,
                        fontWeight   : textStyle.fontWeight,
                        fontStyle    : textStyle.fontStyle ?? "normal",
                        color        : textStyle.color,
                        textAlign    : textStyle.align as React.CSSProperties[ "textAlign" ],
                        wordWrap     : "break-word",
                        border       : `1.5px solid ${ theme.palette.primary.main }`,
                        outline      : "none",
                        background   : "transparent",
                        caretColor   : theme.palette.primary.main,
                        resize       : "none",
                        overflow     : "hidden",
                        padding      : "0",
                        margin       : "0",
                        zIndex       : 10,
                        boxSizing    : "border-box",
                        pointerEvents: "auto",
                    }} />;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    return  <Box ref={ overlayRef } sx={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
                { selected.map( ( node : SvgDocument.ObjectNode ) : JSX.Element =>
                    node.id === editor.state.cropNodeId ? cropBox( node ) : selectionBox( node )
                ) }
                { editingNode !== undefined ? textEditOverlay( editingNode ) : null }
            </Box>;
}

export namespace InteractionOverlay
{
    export interface Props
    {
        doc  : SvgDocument.Doc;
        page : SvgDocument.Page;
    }

    /** A selected object's start position captured at drag start (doc points). */
    export interface StartPos { id : string; x : number; y : number; }

    /** In-flight move-drag state: pointer origin + each object's start position. */
    export interface Drag { startX : number; startY : number; positions : Array<StartPos>; }
}

export default InteractionOverlay;
