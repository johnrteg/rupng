//
import React from "react";
import { JSX } from "react";

import { Divider, Stack, Typography } from "@mui/material";
import FormatAlignLeftOutlinedIcon   from "@mui/icons-material/FormatAlignLeftOutlined";
import FormatAlignCenterOutlinedIcon from "@mui/icons-material/FormatAlignCenterOutlined";
import FormatAlignRightOutlinedIcon  from "@mui/icons-material/FormatAlignRightOutlined";
import VerticalAlignTopOutlinedIcon    from "@mui/icons-material/VerticalAlignTopOutlined";
import VerticalAlignCenterOutlinedIcon from "@mui/icons-material/VerticalAlignCenterOutlined";
import VerticalAlignBottomOutlinedIcon from "@mui/icons-material/VerticalAlignBottomOutlined";

import { SvgDocument } from "@repo/api";

import ButtonIcon from "@widgets/core/ButtonIcon";
import { SvgEditorContext, SvgEditorContextValue } from "@widgets/svg/editor/SvgEditorContext";
import { SvgEditorActionType, ToolMode } from "@widgets/svg/editor/SvgEditorModel";
import { findObject, replaceObject } from "@widgets/svg/editor/SvgDocOps";

//
// SvgContextToolbar — the secondary toolbar row that shows options for the active tool. The Select tool
// exposes six alignment buttons (left / h-center / right + top / v-center / bottom) that operate on the
// selected objects' bounding boxes. Alignment is relative to the tightest bounding box that encloses all
// selected objects. Reads/writes via the editor context.
//
export function SvgContextToolbar() : JSX.Element
{
    const editor : SvgEditorContextValue = React.useContext( SvgEditorContext );

    ////////////////////////////////////////////////////////////////////////////////////////////
    // resolve the currently selected ObjectNodes from the live doc
    function selectedNodes() : Array<SvgDocument.ObjectNode>
    {
        const doc : SvgDocument.Doc | null = editor.state.doc;
        if( doc === null || editor.state.selectedIds.length === 0 ) return [];
        const nodes : Array<SvgDocument.ObjectNode | undefined> = editor.state.selectedIds.map(
            ( id : string ) : SvgDocument.ObjectNode | undefined => findObject( doc, id )
        );
        return nodes.filter( ( node : SvgDocument.ObjectNode | undefined ) : node is SvgDocument.ObjectNode => node !== undefined );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // compute the axis-aligned bounding box that encloses all selected objects (doc points)
    function selectionBounds( nodes : Array<SvgDocument.ObjectNode> ) : { minX : number; minY : number; maxX : number; maxY : number }
    {
        const minX : number = Math.min( ...nodes.map( ( n : SvgDocument.ObjectNode ) : number => n.transform.x ) );
        const minY : number = Math.min( ...nodes.map( ( n : SvgDocument.ObjectNode ) : number => n.transform.y ) );
        const maxX : number = Math.max( ...nodes.map( ( n : SvgDocument.ObjectNode ) : number => n.transform.x + n.transform.width ) );
        const maxY : number = Math.max( ...nodes.map( ( n : SvgDocument.ObjectNode ) : number => n.transform.y + n.transform.height ) );
        return { minX, minY, maxX, maxY };
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // apply an alignment edge/axis to all selected objects and commit the result
    function onAlign( edge : string ) : void
    {
        const doc   : SvgDocument.Doc | null          = editor.state.doc;
        const nodes : Array<SvgDocument.ObjectNode>   = selectedNodes();
        if( doc === null || nodes.length < 2 ) return;

        const bounds : { minX : number; minY : number; maxX : number; maxY : number } = selectionBounds( nodes );
        const hCenter : number = ( bounds.minX + bounds.maxX ) / 2;
        const vCenter : number = ( bounds.minY + bounds.maxY ) / 2;

        let nextDoc : SvgDocument.Doc = doc;
        for( const node of nodes )
        {
            const t : SvgDocument.Transform = node.transform;
            let nextX : number = t.x;
            let nextY : number = t.y;

            if( edge === "left"   ) nextX = bounds.minX;
            if( edge === "center" ) nextX = hCenter - t.width / 2;
            if( edge === "right"  ) nextX = bounds.maxX - t.width;
            if( edge === "top"    ) nextY = bounds.minY;
            if( edge === "middle" ) nextY = vCenter - t.height / 2;
            if( edge === "bottom" ) nextY = bounds.maxY - t.height;

            const updated : SvgDocument.ObjectNode = { ...node, transform: { ...t, x: nextX, y: nextY } };
            nextDoc = replaceObject( nextDoc, node.id, updated );
        }
        editor.dispatch( { type: SvgEditorActionType.SET_DOC, doc: nextDoc } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // the alignment button cluster shown when the Select tool is active
    function alignmentButtons() : JSX.Element
    {
        return  <Stack direction="row" spacing={ 1 } sx={{ alignItems: "center" }}>
                    <Typography variant="caption" sx={{ color: "text.secondary" }}>{"Align"}</Typography>
                    <ButtonIcon id="svg-align-left"    label={"Align left"}    size="small" icon={ <FormatAlignLeftOutlinedIcon fontSize="small" />    } onClick={ () : void => onAlign( "left" ) }   />
                    <ButtonIcon id="svg-align-hcenter" label={"Align center"}  size="small" icon={ <FormatAlignCenterOutlinedIcon fontSize="small" />  } onClick={ () : void => onAlign( "center" ) } />
                    <ButtonIcon id="svg-align-right"   label={"Align right"}   size="small" icon={ <FormatAlignRightOutlinedIcon fontSize="small" />   } onClick={ () : void => onAlign( "right" ) }  />
                    <Divider orientation="vertical" flexItem />
                    <ButtonIcon id="svg-align-top"     label={"Align top"}     size="small" icon={ <VerticalAlignTopOutlinedIcon fontSize="small" />    } onClick={ () : void => onAlign( "top" ) }    />
                    <ButtonIcon id="svg-align-vcenter" label={"Align middle"}  size="small" icon={ <VerticalAlignCenterOutlinedIcon fontSize="small" /> } onClick={ () : void => onAlign( "middle" ) } />
                    <ButtonIcon id="svg-align-bottom"  label={"Align bottom"}  size="small" icon={ <VerticalAlignBottomOutlinedIcon fontSize="small" /> } onClick={ () : void => onAlign( "bottom" ) } />
                </Stack>;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // tool-specific content
    function content() : JSX.Element
    {
        if( editor.state.tool === ToolMode.SELECT ) return alignmentButtons();
        if( editor.state.tool === ToolMode.TEXT )  return <Typography variant="caption" sx={{ color: "text.secondary" }}>{"Text — edit font & size in the inspector"}</Typography>;
        if( editor.state.tool === ToolMode.SHAPE ) return <Typography variant="caption" sx={{ color: "text.secondary" }}>{"Shape — edit fill & stroke in the inspector"}</Typography>;
        return <Typography variant="caption" sx={{ color: "text.secondary" }}>{ " " }</Typography>;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    return  <Stack direction="row" spacing={ 1 } sx={{ alignItems: "center", minHeight: 36, px: 1, borderBottom: 1, borderColor: "divider", bgcolor: "background.paper" }}>
                { content() }
            </Stack>;
}

export default SvgContextToolbar;
