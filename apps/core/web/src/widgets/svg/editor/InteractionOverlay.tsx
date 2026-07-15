//
import React from "react";
import { JSX } from "react";

import { Box, useTheme, Theme } from "@mui/material";

import { SvgDocument } from "@repo/api";

import { SvgEditorContext, SvgEditorContextValue } from "@widgets/svg/editor/SvgEditorContext";
import { SvgEditorActionType } from "@widgets/svg/editor/SvgEditorModel";
import { findObject, replaceObject } from "@widgets/svg/editor/SvgDocOps";

//
// InteractionOverlay — the transparent DOM layer over the compiled SVG that draws selection boxes + handles
// and implements drag-to-move. Resize/rotate handles are shown but their drag is a Phase-2 stub. Coordinates
// convert between document points and screen pixels via the current zoom. Reads/writes the editor context.
//
export function InteractionOverlay( props : InteractionOverlay.Props ) : JSX.Element
{
    const editor : SvgEditorContextValue = React.useContext( SvgEditorContext );
    const theme : Theme = useTheme();

    // refs give the pointer handlers the latest doc + drag origin without re-subscribing mid-drag
    const docRef : React.MutableRefObject<SvgDocument.Doc | null> = React.useRef<SvgDocument.Doc | null>( editor.state.doc );
    docRef.current = editor.state.doc;
    const dragRef : React.MutableRefObject<InteractionOverlay.Drag | null> = React.useRef<InteractionOverlay.Drag | null>( null );

    const zoom : number = editor.state.zoom;

    // the selected objects that still exist in the doc
    const selected : Array<SvgDocument.ObjectNode> = editor.state.doc === null
        ? []
        : editor.state.selectedIds
            .map( ( id : string ) : SvgDocument.ObjectNode | undefined => findObject( editor.state.doc as SvgDocument.Doc, id ) )
            .filter( ( node : SvgDocument.ObjectNode | undefined ) : node is SvgDocument.ObjectNode => node !== undefined );

    ////////////////////////////////////////////////////////////////////////////////////////////
    // begin a move drag — capture the pointer + each selected object's start position (points)
    function onBoxPointerDown( event : React.PointerEvent<HTMLDivElement> ) : void
    {
        event.preventDefault();
        event.currentTarget.setPointerCapture( event.pointerId );
        const positions : Array<InteractionOverlay.StartPos> = selected.map( ( node : SvgDocument.ObjectNode ) : InteractionOverlay.StartPos => ( { id: node.id, x: node.transform.x, y: node.transform.y } ) );
        dragRef.current = { startX: event.clientX, startY: event.clientY, positions };
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // during a move drag — translate the pointer delta (px → pt) onto every dragged object, then commit
    function onBoxPointerMove( event : React.PointerEvent<HTMLDivElement> ) : void
    {
        const drag : InteractionOverlay.Drag | null = dragRef.current;
        const doc : SvgDocument.Doc | null = docRef.current;
        if( drag === null || doc === null ) return;

        // pointer delta in document points
        const deltaX : number = ( event.clientX - drag.startX ) / zoom;
        const deltaY : number = ( event.clientY - drag.startY ) / zoom;

        // apply the delta to each dragged object's start position and rebuild the doc
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

    ////////////////////////////////////////////////////////////////////////////////////////////
    // end a move drag
    function onBoxPointerUp( event : React.PointerEvent<HTMLDivElement> ) : void
    {
        event.currentTarget.releasePointerCapture( event.pointerId );
        dragRef.current = null;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // resize/rotate handle drag is Phase 2 — the handle is drawn but its drag is stubbed
    function onHandleDown( event : React.PointerEvent<HTMLDivElement> ) : void
    {
        event.stopPropagation();
        console.warn( "resize not yet implemented" );
    }
    function onRotateDown( event : React.PointerEvent<HTMLDivElement> ) : void
    {
        event.stopPropagation();
        console.warn( "rotate not yet implemented" );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // the 8 resize handles at the box corners + edge midpoints
    function handles() : Array<JSX.Element>
    {
        const HANDLE : number = 6;
        const positions : Array<{ key : string; left : string; top : string }> =
        [
            { key: "tl", left: "0%",   top: "0%" },   { key: "tc", left: "50%",  top: "0%" },   { key: "tr", left: "100%", top: "0%" },
            { key: "ml", left: "0%",   top: "50%" },  { key: "mr", left: "100%", top: "50%" },
            { key: "bl", left: "0%",   top: "100%" }, { key: "bc", left: "50%",  top: "100%" }, { key: "br", left: "100%", top: "100%" },
        ];
        return positions.map( ( spot : { key : string; left : string; top : string } ) : JSX.Element =>
            <Box key={ spot.key } onPointerDown={ onHandleDown }
                 sx={{ position: "absolute", left: spot.left, top: spot.top, width: HANDLE, height: HANDLE,
                       transform: "translate(-50%, -50%)", bgcolor: "background.paper",
                       border: `1px solid ${ theme.palette.primary.main }`, pointerEvents: "auto", cursor: "nwse-resize" }} /> );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // one selection box (border + handles + rotation handle) for a single object
    function selectionBox( node : SvgDocument.ObjectNode ) : JSX.Element
    {
        const left : number = node.transform.x * zoom;
        const top : number = node.transform.y * zoom;
        const width : number = node.transform.width * zoom;
        const height : number = node.transform.height * zoom;
        return  <Box key={ node.id }
                     sx={{ position: "absolute", left, top, width, height, pointerEvents: "none" }}>
                    {/* the draggable interior + border */}
                    <Box onPointerDown={ onBoxPointerDown } onPointerMove={ onBoxPointerMove } onPointerUp={ onBoxPointerUp }
                         sx={{ position: "absolute", inset: 0, border: `1px solid ${ theme.palette.primary.main }`, pointerEvents: "auto", cursor: "move" }} />
                    {/* rotation handle above top-center, with a connector line */}
                    <Box sx={{ position: "absolute", left: "50%", top: -20, width: "1px", height: 20, bgcolor: "primary.main", transform: "translateX(-50%)", pointerEvents: "none" }} />
                    <Box onPointerDown={ onRotateDown }
                         sx={{ position: "absolute", left: "50%", top: -20, width: 8, height: 8, borderRadius: "50%",
                               bgcolor: "primary.main", transform: "translate(-50%, -50%)", pointerEvents: "auto", cursor: "grab" }} />
                    { handles() }
                </Box>;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    return  <Box sx={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
                { selected.map( ( node : SvgDocument.ObjectNode ) : JSX.Element => selectionBox( node ) ) }
            </Box>;
}

export namespace InteractionOverlay
{
    export interface Props
    {
        doc  : SvgDocument.Doc;
        page : SvgDocument.Page;
    }

    /** A selected object's start position captured at drag start (points). */
    export interface StartPos { id : string; x : number; y : number; }

    /** In-flight drag state (pointer origin + each object's start position). */
    export interface Drag { startX : number; startY : number; positions : Array<StartPos>; }
}

export default InteractionOverlay;
