//
import React from "react";
import { JSX } from "react";

import { Box, Button, Collapse, Stack, TextField, Typography } from "@mui/material";
import VisibilityOutlinedIcon    from "@mui/icons-material/VisibilityOutlined";
import VisibilityOffOutlinedIcon from "@mui/icons-material/VisibilityOffOutlined";
import LockOutlinedIcon          from "@mui/icons-material/LockOutlined";
import LockOpenOutlinedIcon      from "@mui/icons-material/LockOpenOutlined";
import ExpandMoreOutlinedIcon    from "@mui/icons-material/ExpandMoreOutlined";
import ChevronRightOutlinedIcon  from "@mui/icons-material/ChevronRightOutlined";
import AddOutlinedIcon           from "@mui/icons-material/AddOutlined";
import TextFieldsOutlinedIcon    from "@mui/icons-material/TextFieldsOutlined";
import CategoryOutlinedIcon      from "@mui/icons-material/CategoryOutlined";
import ImageOutlinedIcon         from "@mui/icons-material/ImageOutlined";
import FolderOutlinedIcon        from "@mui/icons-material/FolderOutlined";

import { SvgDocument } from "@repo/api";

import ButtonIcon from "@widgets/core/ButtonIcon";
import { SvgEditorContext, SvgEditorContextValue } from "@widgets/svg/editor/SvgEditorContext";
import { SvgEditorActionType, makeId } from "@widgets/svg/editor/SvgEditorModel";
import { updateLayer, addLayer } from "@widgets/svg/editor/SvgDocOps";

//
// SvgLayersPanel — the left panel: the active page's layers (eye/lock toggles, opacity readout, click to
// activate, double-click to rename inline) with each layer's objects listed below (kind icon + name, click to
// select). Reorder is a Phase-2 placeholder (dnd-kit wiring deferred). Reads/writes via the editor context.
//
export function SvgLayersPanel( props : SvgLayersPanel.Props ) : JSX.Element
{
    const editor : SvgEditorContextValue = React.useContext( SvgEditorContext );

    const [ editingLayer, setEditingLayer ] = React.useState<string | null>( null );   // layer id being renamed
    const [ collapsed, setCollapsed ]       = React.useState<Array<string>>( [] );      // collapsed layer ids

    ////////////////////////////////////////////////////////////////////////////////////////////
    // commit a doc change (snapshots for undo + marks dirty)
    function commit( doc : SvgDocument.Doc ) : void
    {
        editor.dispatch( { type: SvgEditorActionType.SET_DOC, doc } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    function toggleHidden( layer : SvgDocument.Layer ) : void
    {
        commit( updateLayer( props.doc, props.page.id, layer.id, { hidden: !layer.hidden } ) );
    }
    function toggleLocked( layer : SvgDocument.Layer ) : void
    {
        commit( updateLayer( props.doc, props.page.id, layer.id, { locked: !layer.locked } ) );
    }
    function renameLayer( layerId : string, name : string ) : void
    {
        commit( updateLayer( props.doc, props.page.id, layerId, { name } ) );
    }
    // finish an inline rename — commit the new name and leave edit mode
    function finishRename( layerId : string, name : string ) : void
    {
        renameLayer( layerId, name );
        setEditingLayer( null );
    }
    function selectLayer( layerId : string ) : void
    {
        editor.dispatch( { type: SvgEditorActionType.SET_ACTIVE_LAYER, layerId } );
    }
    function selectObject( objectId : string ) : void
    {
        editor.dispatch( { type: SvgEditorActionType.SELECT_OBJECTS, ids: [ objectId ] } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // add a new empty layer and make it active
    function onAddLayer() : void
    {
        const layer : SvgDocument.Layer = { id: makeId(), name: `Layer ${ props.page.layers.length + 1 }`, locked: false, hidden: false, opacity: 1, objects: [] };
        commit( addLayer( props.doc, props.page.id, layer ) );
        selectLayer( layer.id );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // toggle a layer's object-list collapse
    function toggleCollapsed( layerId : string ) : void
    {
        setCollapsed( ( current : Array<string> ) : Array<string> => current.includes( layerId ) ? current.filter( ( id : string ) : boolean => id !== layerId ) : [ ...current, layerId ] );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // the icon for an object kind (in the object list)
    function objectIcon( kind : SvgDocument.ObjectKind ) : JSX.Element
    {
        if( kind === SvgDocument.ObjectKind.TEXT )  return <TextFieldsOutlinedIcon fontSize="small" />;
        if( kind === SvgDocument.ObjectKind.IMAGE ) return <ImageOutlinedIcon fontSize="small" />;
        if( kind === SvgDocument.ObjectKind.GROUP ) return <FolderOutlinedIcon fontSize="small" />;
        return <CategoryOutlinedIcon fontSize="small" />;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // one object row inside a layer
    function objectRow( object : SvgDocument.ObjectNode ) : JSX.Element
    {
        const isSelected : boolean = editor.state.selectedIds.includes( object.id );
        return  <Stack key={ object.id } direction="row" spacing={ 1 } onClick={ () : void => selectObject( object.id ) }
                       sx={{ alignItems: "center", pl: 4, pr: 1, py: 0.5, cursor: "pointer", bgcolor: isSelected ? "action.selected" : "transparent", "&:hover": { bgcolor: "action.hover" } }}>
                    { objectIcon( object.kind ) }
                    <Typography variant="body2" noWrap>{ object.name }</Typography>
                </Stack>;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // one layer row (header + its object list)
    function layerRow( layer : SvgDocument.Layer ) : JSX.Element
    {
        const isActive : boolean = editor.state.activeLayer === layer.id;
        const isCollapsed : boolean = collapsed.includes( layer.id );
        return  <Box key={ layer.id }>
                    <Stack direction="row" spacing={ 1 } sx={{ alignItems: "center", px: 1, py: 0.5, bgcolor: isActive ? "action.selected" : "transparent" }}>
                        <ButtonIcon id={ `svg-layer-collapse-${ layer.id }` } label={ isCollapsed ? "Expand" : "Collapse" } size="small"
                                    icon={ isCollapsed ? <ChevronRightOutlinedIcon fontSize="small" /> : <ExpandMoreOutlinedIcon fontSize="small" /> }
                                    onClick={ () : void => toggleCollapsed( layer.id ) } />
                        { editingLayer === layer.id
                            ? <TextField size="small" autoFocus defaultValue={ layer.name }
                                         onBlur={ ( event : React.FocusEvent<HTMLInputElement> ) : void => finishRename( layer.id, event.target.value ) } />
                            : <Typography variant="body2" noWrap sx={{ flexGrow: 1, cursor: "pointer" }}
                                          onClick={ () : void => selectLayer( layer.id ) }
                                          onDoubleClick={ () : void => setEditingLayer( layer.id ) }>{ layer.name }</Typography> }
                        <ButtonIcon id={ `svg-layer-hide-${ layer.id }` } label={ layer.hidden ? "Show" : "Hide" } size="small"
                                    icon={ layer.hidden ? <VisibilityOffOutlinedIcon fontSize="small" /> : <VisibilityOutlinedIcon fontSize="small" /> }
                                    onClick={ () : void => toggleHidden( layer ) } />
                        <ButtonIcon id={ `svg-layer-lock-${ layer.id }` } label={ layer.locked ? "Unlock" : "Lock" } size="small"
                                    icon={ layer.locked ? <LockOutlinedIcon fontSize="small" /> : <LockOpenOutlinedIcon fontSize="small" /> }
                                    onClick={ () : void => toggleLocked( layer ) } />
                    </Stack>
                    <Collapse in={ !isCollapsed } unmountOnExit>
                        { layer.objects.map( ( object : SvgDocument.ObjectNode ) : JSX.Element => objectRow( object ) ) }
                    </Collapse>
                </Box>;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    return  <Box sx={{ width: 240, height: "100%", display: "flex", flexDirection: "column", borderRight: 1, borderColor: "divider", bgcolor: "background.paper" }}>
                <Typography variant="subtitle2" sx={{ px: 2, py: 1, borderBottom: 1, borderColor: "divider" }}>{"Layers"}</Typography>
                <Box sx={{ flexGrow: 1, overflow: "auto" }}>
                    { props.page.layers.map( ( layer : SvgDocument.Layer ) : JSX.Element => layerRow( layer ) ) }
                </Box>
                <Box sx={{ p: 1, borderTop: 1, borderColor: "divider" }}>
                    <Button fullWidth size="small" startIcon={ <AddOutlinedIcon /> } onClick={ onAddLayer }>{"Add Layer"}</Button>
                </Box>
            </Box>;
}

export namespace SvgLayersPanel
{
    export interface Props
    {
        doc  : SvgDocument.Doc;
        page : SvgDocument.Page;
    }
}

export default SvgLayersPanel;
