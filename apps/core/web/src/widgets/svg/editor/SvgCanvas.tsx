//
import React from "react";
import { JSX } from "react";

import { Box } from "@mui/material";

import { SvgDocument } from "@repo/api";

import { SvgEditorContext, SvgEditorContextValue } from "@widgets/svg/editor/SvgEditorContext";
import { SvgEditorActionType } from "@widgets/svg/editor/SvgEditorModel";
import { compilePageForEditor } from "@widgets/svg/editor/SvgCompiler";
import InteractionOverlay from "@widgets/svg/editor/InteractionOverlay";

//
// SvgCanvas — the design surface: the compiled page SVG injected inline, with the InteractionOverlay layered
// over it. Recompiles only when the doc/page changes (useMemo). Click hit-testing reads the object's data-id
// (stamped by the compiler) to drive selection; a click on the transparent background clears it. Sizes to the
// page dimensions scaled by the current zoom (points → pixels 1:1 at 100%).
//
export function SvgCanvas( props : SvgCanvas.Props ) : JSX.Element
{
    const editor : SvgEditorContextValue = React.useContext( SvgEditorContext );
    const zoom : number = editor.state.zoom;

    // recompile the page to an SVG string only when the doc or page identity changes
    const svgMarkup : string = React.useMemo( () : string => compilePageForEditor( props.doc, props.page ), [ props.doc, props.page ] );

    const scaledWidth : number = props.page.size.width * zoom;
    const scaledHeight : number = props.page.size.height * zoom;

    ////////////////////////////////////////////////////////////////////////////////////////////
    // resolve the object under a pointer/click from its data-id ancestor, and update selection
    function onCanvasPointerDown( event : React.PointerEvent<HTMLDivElement> ) : void
    {
        const target : Element = event.target as Element;
        const owner : Element | null = target.closest( "[data-id]" );
        if( owner === null ) { editor.dispatch( { type: SvgEditorActionType.CLEAR_SELECTION } ); return; }
        const id : string | null = owner.getAttribute( "data-id" );
        if( id === null ) { editor.dispatch( { type: SvgEditorActionType.CLEAR_SELECTION } ); return; }
        editor.dispatch( { type: SvgEditorActionType.SELECT_OBJECTS, ids: [ id ] } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    return  <Box sx={{ position: "relative", width: scaledWidth, height: scaledHeight, boxShadow: 3, bgcolor: "background.paper",
                       "& svg": { width: "100%", height: "100%", display: "block" } }}>
                {/* the compiled page — the single rendering path (same output as export) */}
                <Box onPointerDown={ onCanvasPointerDown } sx={{ position: "absolute", inset: 0 }} dangerouslySetInnerHTML={ { __html: svgMarkup } } />
                <InteractionOverlay doc={ props.doc } page={ props.page } />
            </Box>;
}

export namespace SvgCanvas
{
    export interface Props
    {
        doc  : SvgDocument.Doc;
        page : SvgDocument.Page;
    }
}

export default SvgCanvas;
