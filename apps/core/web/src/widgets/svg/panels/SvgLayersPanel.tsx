//
import React from "react";
import { JSX } from "react";

import { Box, Button, Collapse, Menu, MenuItem, Stack, TextField, Typography } from "@mui/material";
import VisibilityOutlinedIcon    from "@mui/icons-material/VisibilityOutlined";
import VisibilityOffOutlinedIcon from "@mui/icons-material/VisibilityOffOutlined";
import LockOutlinedIcon          from "@mui/icons-material/LockOutlined";
import LockOpenOutlinedIcon      from "@mui/icons-material/LockOpenOutlined";
import ExpandMoreOutlinedIcon    from "@mui/icons-material/ExpandMoreOutlined";
import ChevronRightOutlinedIcon  from "@mui/icons-material/ChevronRightOutlined";
import AddOutlinedIcon           from "@mui/icons-material/AddOutlined";
import DragIndicatorOutlinedIcon from "@mui/icons-material/DragIndicatorOutlined";
import TextFieldsOutlinedIcon    from "@mui/icons-material/TextFieldsOutlined";
import CategoryOutlinedIcon      from "@mui/icons-material/CategoryOutlined";
import ImageOutlinedIcon         from "@mui/icons-material/ImageOutlined";
import FolderOutlinedIcon        from "@mui/icons-material/FolderOutlined";

import { SvgDocument } from "@repo/api";

import ButtonIcon from "@widgets/core/ButtonIcon";
import { SvgEditorContext, SvgEditorContextValue } from "@widgets/svg/editor/SvgEditorContext";
import { SvgEditorActionType, makeId } from "@widgets/svg/editor/SvgEditorModel";
import { updateLayer, addLayer, replaceObject, moveObjectInLayer, moveLayer } from "@widgets/svg/editor/SvgDocOps";

//
// SvgLayersPanel — the left panel: the active page's layers (eye/lock toggles, opacity readout, click to
// activate, double-click to rename inline) with each layer's objects listed below (kind icon + name, click to
// select, double-click to rename, right-click for z-order operations). Layers can be reordered by dragging
// the drag-handle on the left of each row. Reads/writes via the editor context.
//
export function SvgLayersPanel( props : SvgLayersPanel.Props ) : JSX.Element
{
    const editor : SvgEditorContextValue = React.useContext( SvgEditorContext );

    const [ editingLayer, setEditingLayer ]   = React.useState<string | null>( null );
    const [ editingObject, setEditingObject ] = React.useState<string | null>( null );
    const [ collapsed, setCollapsed ]         = React.useState<Array<string>>( [] );
    // context menu state: position + which object + which layer it belongs to
    const [ contextMenu, setContextMenu ] = React.useState<{ x : number; y : number; objectId : string; layerId : string } | null>( null );
    // drag-and-drop layer reorder state
    const draggingLayerId : React.MutableRefObject<string | null> = React.useRef<string | null>( null );
    const [ dragOverLayerId, setDragOverLayerId ] = React.useState<string | null>( null );

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
    function finishRename( layerId : string, name : string ) : void
    {
        renameLayer( layerId, name );
        setEditingLayer( null );
    }
    function onLayerRenameKeyDown( event : React.KeyboardEvent<HTMLInputElement>, layerId : string ) : void
    {
        if( event.key === "Enter"  ) finishRename( layerId, ( event.target as HTMLInputElement ).value );
        if( event.key === "Escape" ) setEditingLayer( null );
    }
    function selectLayer( layerId : string ) : void
    {
        editor.dispatch( { type: SvgEditorActionType.SET_ACTIVE_LAYER, layerId } );
    }
    function selectObject( objectId : string ) : void
    {
        editor.dispatch( { type: SvgEditorActionType.SELECT_OBJECTS, ids: [ objectId ] } );
    }
    function finishObjectRename( object : SvgDocument.ObjectNode, name : string ) : void
    {
        commit( replaceObject( props.doc, object.id, { ...object, name } ) );
        setEditingObject( null );
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
        setCollapsed( ( current : Array<string> ) : Array<string> =>
            current.includes( layerId )
                ? current.filter( ( id : string ) : boolean => id !== layerId )
                : [ ...current, layerId ]
        );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // ── Layer drag-and-drop reordering ────────────────────────────────────────

    // record which layer started being dragged
    function onLayerDragStart( event : React.DragEvent<HTMLDivElement>, layerId : string ) : void
    {
        draggingLayerId.current = layerId;
        event.dataTransfer.effectAllowed = "move";
    }

    // allow drop + highlight the target row
    function onLayerDragOver( event : React.DragEvent<HTMLDivElement>, layerId : string ) : void
    {
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        if( dragOverLayerId !== layerId ) setDragOverLayerId( layerId );
    }

    // clear the drop highlight when leaving a row
    function onLayerDragLeave() : void
    {
        setDragOverLayerId( null );
    }

    // commit the reorder on drop
    function onLayerDrop( event : React.DragEvent<HTMLDivElement>, targetLayerId : string ) : void
    {
        event.preventDefault();
        const sourceId : string | null = draggingLayerId.current;
        draggingLayerId.current = null;
        setDragOverLayerId( null );
        if( sourceId === null || sourceId === targetLayerId ) return;
        const toIndex : number = props.page.layers.findIndex( ( layer : SvgDocument.Layer ) : boolean => layer.id === targetLayerId );
        if( toIndex < 0 ) return;
        commit( moveLayer( props.doc, props.page.id, sourceId, toIndex ) );
    }

    // clear drag state if the user drops outside any valid target
    function onLayerDragEnd() : void
    {
        draggingLayerId.current = null;
        setDragOverLayerId( null );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // ── Context menu (z-order) ────────────────────────────────────────────────

    // open the z-order context menu for the right-clicked object row
    function onObjectContextMenu( event : React.MouseEvent<HTMLElement>, objectId : string, layerId : string ) : void
    {
        event.preventDefault();
        event.stopPropagation();
        setContextMenu( { x: event.clientX, y: event.clientY, objectId, layerId } );
    }

    function closeContextMenu() : void
    {
        setContextMenu( null );
    }

    // move the context-menu object to a new index in its layer
    function moveContextObject( toIndex : number | "front" | "back" ) : void
    {
        if( contextMenu === null ) return;
        const { objectId, layerId } = contextMenu;
        const layer : SvgDocument.Layer | undefined = props.page.layers.find(
            ( candidate : SvgDocument.Layer ) : boolean => candidate.id === layerId
        );
        if( layer === undefined ) return;
        const currentIndex : number = layer.objects.findIndex(
            ( object : SvgDocument.ObjectNode ) : boolean => object.id === objectId
        );
        if( currentIndex < 0 ) return;
        const resolved : number = toIndex === "front" ? layer.objects.length - 1
            : toIndex === "back" ? 0
            : currentIndex + toIndex;
        commit( moveObjectInLayer( props.doc, props.page.id, layerId, objectId, resolved ) );
        closeContextMenu();
    }

    function onBringToFront()  : void { moveContextObject( "front" ); }
    function onBringForward()  : void { moveContextObject(  1 ); }
    function onSendBackward()  : void { moveContextObject( -1 ); }
    function onSendToBack()    : void { moveContextObject( "back" ); }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // the icon for an object kind
    function objectIcon( kind : SvgDocument.ObjectKind ) : JSX.Element
    {
        if( kind === SvgDocument.ObjectKind.TEXT )  return <TextFieldsOutlinedIcon fontSize="small" />;
        if( kind === SvgDocument.ObjectKind.IMAGE ) return <ImageOutlinedIcon fontSize="small" />;
        if( kind === SvgDocument.ObjectKind.GROUP ) return <FolderOutlinedIcon fontSize="small" />;
        return <CategoryOutlinedIcon fontSize="small" />;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // one object row: click = select, double-click = rename, right-click = z-order menu
    function objectRow( object : SvgDocument.ObjectNode, layerId : string ) : JSX.Element
    {
        const isSelected : boolean = editor.state.selectedIds.includes( object.id );
        const isEditing  : boolean = editingObject === object.id;
        return  <Stack key={ object.id } direction="row" spacing={ 1 }
                       onClick={ () : void => selectObject( object.id ) }
                       onContextMenu={ ( event : React.MouseEvent<HTMLElement> ) : void => onObjectContextMenu( event, object.id, layerId ) }
                       sx={{ alignItems: "center", pl: 4, pr: 1, py: 0.5, cursor: "pointer",
                             bgcolor: isSelected ? "action.selected" : "transparent",
                             "&:hover": { bgcolor: "action.hover" } }}>
                    { objectIcon( object.kind ) }
                    { isEditing
                        ? <TextField size="small" autoFocus defaultValue={ object.name } sx={{ flexGrow: 1 }}
                                     onClick={ ( event : React.MouseEvent<HTMLDivElement> ) : void => event.stopPropagation() }
                                     onBlur={ ( event : React.FocusEvent<HTMLInputElement> ) : void => finishObjectRename( object, event.target.value ) }
                                     onKeyDown={ ( event : React.KeyboardEvent<HTMLInputElement> ) : void =>
                                     {
                                         if( event.key === "Enter" ) finishObjectRename( object, ( event.target as HTMLInputElement ).value );
                                         if( event.key === "Escape" ) setEditingObject( null );
                                     } } />
                        : <Typography variant="body2" noWrap sx={{ flexGrow: 1 }}
                                      onDoubleClick={ ( event : React.MouseEvent<HTMLElement> ) : void =>
                                      {
                                          event.stopPropagation();
                                          setEditingObject( object.id );
                                      } }>
                              { object.name }
                          </Typography> }
                </Stack>;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // one layer row (header + its object list); the drag handle on the left triggers HTML5 DnD
    function layerRow( layer : SvgDocument.Layer ) : JSX.Element
    {
        const isActive    : boolean = editor.state.activeLayer === layer.id;
        const isCollapsed : boolean = collapsed.includes( layer.id );
        const isDragging  : boolean = draggingLayerId.current === layer.id;
        const isDragOver  : boolean = dragOverLayerId === layer.id;
        return  <Box key={ layer.id }
                     draggable
                     onDragStart={ ( event : React.DragEvent<HTMLDivElement> ) : void => onLayerDragStart( event, layer.id ) }
                     onDragOver={  ( event : React.DragEvent<HTMLDivElement> ) : void => onLayerDragOver(  event, layer.id ) }
                     onDragLeave={ () : void => onLayerDragLeave() }
                     onDrop={      ( event : React.DragEvent<HTMLDivElement> ) : void => onLayerDrop(      event, layer.id ) }
                     onDragEnd={   () : void => onLayerDragEnd() }
                     sx={{ opacity: isDragging ? 0.4 : 1,
                           borderTop: isDragOver ? 2 : 0,
                           borderColor: "primary.main",
                           transition: "opacity 0.1s" }}>
                    <Stack direction="row" spacing={ 1 } sx={{ alignItems: "center", px: 1, py: 0.5, bgcolor: isActive ? "action.selected" : "transparent" }}>
                        { /* drag handle — cursor:grab signals the affordance */ }
                        <Box sx={{ display: "flex", alignItems: "center", cursor: "grab", color: "text.disabled", flexShrink: 0 }}>
                            <DragIndicatorOutlinedIcon fontSize="small" />
                        </Box>
                        <ButtonIcon id={ `svg-layer-collapse-${ layer.id }` } label={ isCollapsed ? "Expand" : "Collapse" } size="small"
                                    icon={ isCollapsed ? <ChevronRightOutlinedIcon fontSize="small" /> : <ExpandMoreOutlinedIcon fontSize="small" /> }
                                    onClick={ () : void => toggleCollapsed( layer.id ) } />
                        { editingLayer === layer.id
                            ? <TextField size="small" autoFocus defaultValue={ layer.name }
                                         onBlur={ ( event : React.FocusEvent<HTMLInputElement> ) : void => finishRename( layer.id, event.target.value ) }
                                         onKeyDown={ ( event : React.KeyboardEvent<HTMLInputElement> ) : void => onLayerRenameKeyDown( event, layer.id ) } />
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
                        { [ ...layer.objects ].reverse().map( ( object : SvgDocument.ObjectNode ) : JSX.Element => objectRow( object, layer.id ) ) }
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

                {/* z-order context menu — anchored to right-click position */}
                <Menu open={ contextMenu !== null }
                      anchorReference="anchorPosition"
                      anchorPosition={ contextMenu !== null ? { top: contextMenu.y, left: contextMenu.x } : undefined }
                      onClose={ closeContextMenu }>
                    <MenuItem onClick={ onBringToFront }>{"Bring to Front"}</MenuItem>
                    <MenuItem onClick={ onBringForward }>{"Bring Forward"}</MenuItem>
                    <MenuItem onClick={ onSendBackward }>{"Send Backward"}</MenuItem>
                    <MenuItem onClick={ onSendToBack }>{"Send to Back"}</MenuItem>
                </Menu>
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
