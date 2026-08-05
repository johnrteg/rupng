//
import React from "react";
import { JSX } from "react";

import { Box, Divider, Stack, Typography } from "@mui/material";
import NearMeOutlinedIcon           from "@mui/icons-material/NearMeOutlined";
import TextFieldsOutlinedIcon       from "@mui/icons-material/TextFieldsOutlined";
import CropSquareOutlinedIcon       from "@mui/icons-material/CropSquareOutlined";
import CircleOutlinedIcon           from "@mui/icons-material/CircleOutlined";
import PanToolOutlinedIcon          from "@mui/icons-material/PanToolOutlined";
import ImageOutlinedIcon            from "@mui/icons-material/ImageOutlined";
import CategoryOutlinedIcon         from "@mui/icons-material/CategoryOutlined";
import UndoOutlinedIcon             from "@mui/icons-material/UndoOutlined";
import RedoOutlinedIcon             from "@mui/icons-material/RedoOutlined";
import ZoomInOutlinedIcon           from "@mui/icons-material/ZoomInOutlined";
import ZoomOutOutlinedIcon          from "@mui/icons-material/ZoomOutOutlined";
import HorizontalRuleOutlinedIcon   from "@mui/icons-material/HorizontalRuleOutlined";
import PolylineOutlinedIcon         from "@mui/icons-material/PolylineOutlined";
import PentagonOutlinedIcon         from "@mui/icons-material/PentagonOutlined";
import ShowChartOutlinedIcon        from "@mui/icons-material/ShowChartOutlined";

import ButtonIcon from "@widgets/core/ButtonIcon";
import Pusher from "@widgets/core/Pusher";
import { SvgEditorContext, SvgEditorContextValue } from "@widgets/svg/editor/SvgEditorContext";
import { SvgEditorActionType, ToolMode } from "@widgets/svg/editor/SvgEditorModel";

//
// SvgMainToolbar — the top toolbar: tool selector, undo/redo, and zoom controls, plus a live save-state
// label. Save / Cancel / Export live in MediaStudio's title-area banner (not here — see SvgDesignEditor.Handle),
// consistent with the email template editor's title-area action placement.
//
export function SvgMainToolbar( props : SvgMainToolbar.Props ) : JSX.Element
{
    const editor : SvgEditorContextValue = React.useContext( SvgEditorContext );

    const ZOOM_STEP : number = 1.2;
    const ZOOM_MIN  : number = 0.1;
    const ZOOM_MAX  : number = 8;

    const canUndo : boolean = editor.state.history.past.length > 0;
    const canRedo : boolean = editor.state.history.future.length > 0;
    const isDirty : boolean = editor.state.dirtyFlag;

    ////////////////////////////////////////////////////////////////////////////////////////////
    function setTool( tool : ToolMode ) : void
    {
        editor.dispatch( { type: SvgEditorActionType.SET_TOOL, tool } );
    }
    function onUndo() : void
    {
        editor.dispatch( { type: SvgEditorActionType.UNDO } );
    }
    function onRedo() : void
    {
        editor.dispatch( { type: SvgEditorActionType.REDO } );
    }
    function zoomTo( zoom : number ) : void
    {
        editor.dispatch( { type: SvgEditorActionType.SET_ZOOM, zoom: Math.max( ZOOM_MIN, Math.min( ZOOM_MAX, zoom ) ) } );
    }
    function onZoomIn()  : void { zoomTo( editor.state.zoom * ZOOM_STEP ); }
    function onZoomOut() : void { zoomTo( editor.state.zoom / ZOOM_STEP ); }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // the current save-state label (drives the indicator on the right)
    function saveLabel() : string
    {
        if( props.saving ) return "Saving…";
        if( isDirty ) return "Unsaved changes";
        return "Saved";
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // a tool button — highlighted (primary) when it is the active tool
    function toolButton( id : string, tool : ToolMode, label : string, icon : JSX.Element ) : JSX.Element
    {
        return <ButtonIcon id={ id } label={ label } size="small" color={ editor.state.tool === tool ? "primary" : "inherit" } icon={ icon } onClick={ () : void => setTool( tool ) } />;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    return  <Stack direction="row" spacing={ 1 } sx={{ alignItems: "center", px: 1, py: 0.5, borderBottom: 1, borderColor: "divider", bgcolor: "background.paper" }}>
                { toolButton( "svg-tool-select",  ToolMode.SELECT,  "Select (V)",    <NearMeOutlinedIcon fontSize="small" /> ) }
                { toolButton( "svg-tool-text",    ToolMode.TEXT,    "Text (T)",      <TextFieldsOutlinedIcon fontSize="small" /> ) }
                { toolButton( "svg-tool-rect",    ToolMode.SHAPE,   "Rectangle (R)", <CropSquareOutlinedIcon fontSize="small" /> ) }
                { toolButton( "svg-tool-ellipse",  ToolMode.ELLIPSE,  "Ellipse (E)",   <CircleOutlinedIcon fontSize="small" /> ) }
                { toolButton( "svg-tool-line",     ToolMode.LINE,    "Line (L)",      <HorizontalRuleOutlinedIcon fontSize="small" /> ) }
                { toolButton( "svg-tool-polyline", ToolMode.PEN,     "Polyline (P)",  <PolylineOutlinedIcon fontSize="small" /> ) }
                { toolButton( "svg-tool-polygon",  ToolMode.POLYGON, "Polygon (O)",   <PentagonOutlinedIcon fontSize="small" /> ) }
                { toolButton( "svg-tool-bezier",   ToolMode.BEZIER,  "Bezier (B)",    <ShowChartOutlinedIcon fontSize="small" /> ) }
                { toolButton( "svg-tool-pan",      ToolMode.PAN,     "Pan (Space)",   <PanToolOutlinedIcon fontSize="small" /> ) }
                <ButtonIcon id="svg-tool-image" label={"Insert image"} size="small" icon={ <ImageOutlinedIcon fontSize="small" /> } onClick={ props.onInsertImage } />
                <ButtonIcon id="svg-tool-svg"   label={"Insert SVG"}   size="small" icon={ <CategoryOutlinedIcon fontSize="small" /> } onClick={ props.onInsertSvg } />

                <Divider orientation="vertical" flexItem />

                <ButtonIcon id="svg-undo" label={"Undo (⌘Z)"}   size="small" disabled={ !canUndo } icon={ <UndoOutlinedIcon fontSize="small" /> } onClick={ onUndo } />
                <ButtonIcon id="svg-redo" label={"Redo (⌘⇧Z)"}  size="small" disabled={ !canRedo } icon={ <RedoOutlinedIcon fontSize="small" /> } onClick={ onRedo } />

                <Divider orientation="vertical" flexItem />

                <ButtonIcon id="svg-zoom-out" label={"Zoom out"} size="small" icon={ <ZoomOutOutlinedIcon fontSize="small" /> } onClick={ onZoomOut } />
                <Typography variant="body2" sx={{ minWidth: 44, textAlign: "center" }}>{ `${ Math.round( editor.state.zoom * 100 ) }%` }</Typography>
                <ButtonIcon id="svg-zoom-in"  label={"Zoom in"}  size="small" icon={ <ZoomInOutlinedIcon  fontSize="small" /> } onClick={ onZoomIn } />

                <Pusher />

                <Box sx={{ minWidth: 100, textAlign: "right" }}>
                    <Typography variant="caption" sx={{ color: "text.secondary" }}>{ saveLabel() }</Typography>
                </Box>
            </Stack>;
}

export namespace SvgMainToolbar
{
    export interface Props
    {
        onInsertImage : () => void;
        onInsertSvg   : () => void;
        saving        : boolean;
    }
}

export default SvgMainToolbar;
