//
import React from "react";
import { JSX } from "react";

import { Box, Stack, Typography } from "@mui/material";
import TuneOutlinedIcon from "@mui/icons-material/TuneOutlined";

import { SvgDocument } from "@repo/api";

import ButtonIcon from "@widgets/core/ButtonIcon";
import { SvgEditorContext, SvgEditorContextValue } from "@widgets/svg/editor/SvgEditorContext";
import { SvgEditorActionType, InspectorMode } from "@widgets/svg/editor/SvgEditorModel";
import { findObject, replaceObject, pageById } from "@widgets/svg/editor/SvgDocOps";
import TransformInspector from "./TransformInspector";
import TextInspector from "./TextInspector";
import ShapeInspector from "./ShapeInspector";
import ImageInspector from "./ImageInspector";

//
// SvgPropertyInspector — the context-sensitive right panel. Reads the selection from the editor context and
// renders the transform controls plus a kind-specific inspector (text / shape / image / group). A
// Simple/Advanced toggle at the top switches the detail level (stored in the editor state). All edits build a
// new doc via SvgDocOps and dispatch SET_DOC.
//
export function SvgPropertyInspector() : JSX.Element
{
    const editor : SvgEditorContextValue = React.useContext( SvgEditorContext );
    const doc : SvgDocument.Doc | null = editor.state.doc;

    // resolve the selected objects (skip any stale ids no longer in the doc)
    const selected : Array<SvgDocument.ObjectNode> = doc === null
        ? []
        : editor.state.selectedIds
            .map( ( id : string ) : SvgDocument.ObjectNode | undefined => findObject( doc, id ) )
            .filter( ( node : SvgDocument.ObjectNode | undefined ) : node is SvgDocument.ObjectNode => node !== undefined );

    // the active page's display unit drives the transform inputs
    const page : SvgDocument.Page | undefined = doc !== null ? pageById( doc, editor.state.activePage ) : undefined;
    const unit : SvgDocument.Unit = page?.size.unit ?? SvgDocument.Unit.PT;

    ////////////////////////////////////////////////////////////////////////////////////////////
    // flip the inspector detail level (persisted in the editor state)
    function toggleMode() : void
    {
        const next : InspectorMode = editor.state.inspectorMode === "simple" ? "advanced" : "simple";
        editor.dispatch( { type: SvgEditorActionType.SET_INSPECTOR_MODE, mode: next } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // replace a single object in the doc and commit (SET_DOC snapshots for undo + marks dirty)
    function commitNode( next : SvgDocument.ObjectNode ) : void
    {
        if( doc === null ) return;
        const nextDoc : SvgDocument.Doc = replaceObject( doc, next.id, next );
        editor.dispatch( { type: SvgEditorActionType.SET_DOC, doc: nextDoc } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // transform edit for the single selected object
    function onTransformChange( transform : SvgDocument.Transform ) : void
    {
        const node : SvgDocument.ObjectNode | undefined = selected[ 0 ];
        if( node === undefined ) return;
        commitNode( { ...node, transform } );
    }
    function onOpacityChange( opacity : number ) : void
    {
        const node : SvgDocument.ObjectNode | undefined = selected[ 0 ];
        if( node === undefined ) return;
        commitNode( { ...node, opacity } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // kind-specific node edits (each inspector reports a fully-typed node back)
    function onTextChange( node : SvgDocument.TextNode ) : void { commitNode( node ); }
    function onShapeChange( node : SvgDocument.ShapeNode ) : void { commitNode( node ); }
    function onImageChange( node : SvgDocument.ImageNode ) : void { commitNode( node ); }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // the header row — title + the Simple/Advanced toggle
    function header() : JSX.Element
    {
        return  <Stack direction="row" spacing={ 1 } sx={{ alignItems: "center", px: 2, py: 1, borderBottom: 1, borderColor: "divider" }}>
                    <Typography variant="subtitle2" sx={{ flexGrow: 1 }}>{"Properties"}</Typography>
                    <ButtonIcon id="svg-inspector-mode" label={ editor.state.inspectorMode === "simple" ? "Advanced" : "Simple" }
                                size="small" icon={ <TuneOutlinedIcon fontSize="small" /> } onClick={ toggleMode } />
                </Stack>;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // the kind-specific inspector for the single selected object
    function detailFor( node : SvgDocument.ObjectNode ) : JSX.Element | null
    {
        if( node.kind === SvgDocument.ObjectKind.TEXT )  return <TextInspector node={ node } onChange={ onTextChange } />;
        if( node.kind === SvgDocument.ObjectKind.SHAPE ) return <ShapeInspector node={ node } onChange={ onShapeChange } />;
        if( node.kind === SvgDocument.ObjectKind.IMAGE ) return <ImageInspector node={ node } onChange={ onImageChange } />;
        if( node.kind === SvgDocument.ObjectKind.GROUP ) return <Typography variant="body2" sx={{ color: "text.secondary" }}>{"Group"}</Typography>;
        return null;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // the body varies by selection count
    function body() : JSX.Element
    {
        if( selected.length === 0 )
            return <Typography variant="body2" sx={{ color: "text.secondary", p: 2 }}>{"Select an object to edit its properties"}</Typography>;

        if( selected.length > 1 )
            return  <Stack spacing={ 2 } sx={{ p: 2 }}>
                        <Typography variant="body2" sx={{ color: "text.secondary" }}>{`${ selected.length } objects selected`}</Typography>
                    </Stack>;

        const node : SvgDocument.ObjectNode = selected[ 0 ];
        return  <Stack spacing={ 2 } sx={{ p: 2 }}>
                    <TransformInspector transform={ node.transform } opacity={ node.opacity } unit={ unit }
                                        onChange={ onTransformChange } onOpacityChange={ onOpacityChange } />
                    { detailFor( node ) }
                </Stack>;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    return  <Box sx={{ width: 280, height: "100%", display: "flex", flexDirection: "column", borderLeft: 1, borderColor: "divider", bgcolor: "background.paper", overflow: "auto" }}>
                { header() }
                { body() }
            </Box>;
}

export default SvgPropertyInspector;
