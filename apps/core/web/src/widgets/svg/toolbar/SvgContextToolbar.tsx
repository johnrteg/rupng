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

import ButtonIcon from "@widgets/core/ButtonIcon";
import { SvgEditorContext, SvgEditorContextValue } from "@widgets/svg/editor/SvgEditorContext";
import { ToolMode } from "@widgets/svg/editor/SvgEditorModel";

//
// SvgContextToolbar — the secondary toolbar row that shows options for the active tool. MVP: the Select tool
// exposes alignment buttons (stubbed — alignment is Phase 2); the Text/Shape tools show a short hint pointing
// at the property inspector. Reads the active tool from the editor context.
//
export function SvgContextToolbar() : JSX.Element
{
    const editor : SvgEditorContextValue = React.useContext( SvgEditorContext );

    ////////////////////////////////////////////////////////////////////////////////////////////
    // alignment is a Phase-2 feature — the buttons are present but log for now
    function onAlign( edge : string ) : void
    {
        console.warn( `align ${ edge } not yet implemented` );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // the alignment button cluster (Select tool)
    function alignmentButtons() : JSX.Element
    {
        return  <Stack direction="row" spacing={ 1 } sx={{ alignItems: "center" }}>
                    <Typography variant="caption" sx={{ color: "text.secondary" }}>{"Align"}</Typography>
                    <ButtonIcon id="svg-align-left" label={"Align left"} size="small" icon={ <FormatAlignLeftOutlinedIcon fontSize="small" /> } onClick={ () : void => onAlign( "left" ) } />
                    <ButtonIcon id="svg-align-hcenter" label={"Align center"} size="small" icon={ <FormatAlignCenterOutlinedIcon fontSize="small" /> } onClick={ () : void => onAlign( "center" ) } />
                    <ButtonIcon id="svg-align-right" label={"Align right"} size="small" icon={ <FormatAlignRightOutlinedIcon fontSize="small" /> } onClick={ () : void => onAlign( "right" ) } />
                    <Divider orientation="vertical" flexItem />
                    <ButtonIcon id="svg-align-top" label={"Align top"} size="small" icon={ <VerticalAlignTopOutlinedIcon fontSize="small" /> } onClick={ () : void => onAlign( "top" ) } />
                    <ButtonIcon id="svg-align-vcenter" label={"Align middle"} size="small" icon={ <VerticalAlignCenterOutlinedIcon fontSize="small" /> } onClick={ () : void => onAlign( "middle" ) } />
                    <ButtonIcon id="svg-align-bottom" label={"Align bottom"} size="small" icon={ <VerticalAlignBottomOutlinedIcon fontSize="small" /> } onClick={ () : void => onAlign( "bottom" ) } />
                </Stack>;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // the tool-specific content
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
