import AppModel from "@model/AppModel";
//
import React from "react";
import { JSX } from "react";

import { Box, CircularProgress, Stack, Typography } from "@mui/material";

import { SvgDocument, GetSvgCanvas, PutSvgCanvas } from "@repo/api";
import { RestfulService } from "@repo/endpoint";

import SnackAlert from "@widgets/core/SnackAlert";
import SvgService from "@model/service/SvgService";

import { SvgEditorContext } from "@widgets/svg/editor/SvgEditorContext";
import { svgEditorReducer } from "@widgets/svg/editor/svgEditorReducer";
import { SvgEditorState, SvgEditorAction, SvgEditorActionType, ToolMode, makeInitialState, makeId, defaultTransform } from "@widgets/svg/editor/SvgEditorModel";
import { pageById, deleteObjects, addObject } from "@widgets/svg/editor/SvgDocOps";
import SvgCanvas from "@widgets/svg/editor/SvgCanvas";
import RulerBar from "@widgets/svg/editor/RulerBar";
import SvgLayersPanel from "@widgets/svg/panels/SvgLayersPanel";
import SvgPagesPanel from "@widgets/svg/panels/SvgPagesPanel";
import SvgPropertyInspector from "@widgets/svg/inspector/SvgPropertyInspector";
import SvgMainToolbar from "@widgets/svg/toolbar/SvgMainToolbar";
import SvgContextToolbar from "@widgets/svg/toolbar/SvgContextToolbar";
import ExportDialog from "@pages/media/dialogs/ExportDialog";

//
// SvgDesignEditor — the editor shell. Owns the reducer state (useReducer + SvgEditorContext.Provider), loads
// the project's doc on mount, autosaves on a 2-second debounce, and wires the keyboard shortcuts. Composes
// the toolbars, the layers panel, the ruled canvas, the property inspector, and the pages strip.
//
export function SvgDesignEditor( props : SvgDesignEditor.Props ) : JSX.Element
{
    const appmodel : AppModel = AppModel.instance();
    const svc : SvgService = React.useMemo( () : SvgService => new SvgService( appmodel ), [ appmodel ] );

    const [ state, dispatch ] = React.useReducer( svgEditorReducer, undefined, makeInitialState );
    const [ loading, setLoading ] = React.useState<boolean>( true );
    const [ saving, setSaving ]   = React.useState<boolean>( false );
    const [ exporting, setExporting ] = React.useState<boolean>( false );
    const [ snack, setSnack ]     = React.useState<{ message : string; severity : SnackAlert.Severity } | null>( null );

    // a ref mirror of the latest state so the (once-registered) key handler reads current values
    const stateRef : React.MutableRefObject<SvgEditorState> = React.useRef<SvgEditorState>( state );
    stateRef.current = state;

    React.useEffect( componentLoaded, [] );
    React.useEffect( dirtyChanged, [ state.doc, state.dirtyFlag ] );

    ////////////////////////////////////////////////////////////////////////////////////////////
    // on mount: load the project doc + register keyboard shortcuts (cleanup removes the listener)
    function componentLoaded() : () => void
    {
        void load();
        window.addEventListener( "keydown", onKeyDown );
        return () : void => window.removeEventListener( "keydown", onKeyDown );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // fetch the project's editable doc; on success load it into the reducer, else surface the error
    async function load() : Promise<void>
    {
        setLoading( true );
        const reply : RestfulService.Reply<GetSvgCanvas.Response> = await svc.getCanvas( props.projectId );
        setLoading( false );
        if( reply.ok && reply.data ) dispatch( { type: SvgEditorActionType.LOAD_DOC, doc: reply.data.doc } );
        else setSnack( { message: "Could not load the design.", severity: "error" } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // autosave — (re)arm a 2-second debounce whenever the doc changes while dirty; the timer saves
    function dirtyChanged() : void | ( () => void )
    {
        if( !state.dirtyFlag ) return;
        const timer : ReturnType<typeof setTimeout> = setTimeout( () : void => void save(), 2000 );
        return () : void => clearTimeout( timer );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // persist the current doc, then clear the dirty flag (branch on the reply — fetch never throws)
    async function save() : Promise<void>
    {
        const doc : SvgDocument.Doc | null = stateRef.current.doc;
        if( doc === null ) return;
        setSaving( true );
        const reply : RestfulService.Reply<PutSvgCanvas.Response> = await svc.putCanvas( props.projectId, doc );
        setSaving( false );
        if( reply.ok ) dispatch( { type: SvgEditorActionType.CLEAR_DIRTY } );
        else setSnack( { message: "Autosave failed — retrying on the next change.", severity: "warning" } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // delete the selected objects from the active layer
    function deleteSelected() : void
    {
        const current : SvgEditorState = stateRef.current;
        if( current.doc === null || current.selectedIds.length === 0 ) return;
        const nextDoc : SvgDocument.Doc = deleteObjects( current.doc, current.activePage, current.activeLayer, current.selectedIds );
        dispatch( { type: SvgEditorActionType.SET_DOC, doc: nextDoc } );
        dispatch( { type: SvgEditorActionType.CLEAR_SELECTION } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // group the selected objects on the active layer into a GroupNode (children re-based to the group origin)
    function groupSelected() : void
    {
        const current : SvgEditorState = stateRef.current;
        if( current.doc === null || current.selectedIds.length < 2 ) return;
        const page : SvgDocument.Page | undefined = pageById( current.doc, current.activePage );
        const layer : SvgDocument.Layer | undefined = page?.layers.find( ( candidate : SvgDocument.Layer ) : boolean => candidate.id === current.activeLayer );
        if( page === undefined || layer === undefined ) return;

        // the selected objects (top-level on the active layer) + their bounding box
        const members : Array<SvgDocument.ObjectNode> = layer.objects.filter( ( object : SvgDocument.ObjectNode ) : boolean => current.selectedIds.includes( object.id ) );
        if( members.length < 2 ) return;
        const minX : number = Math.min( ...members.map( ( object : SvgDocument.ObjectNode ) : number => object.transform.x ) );
        const minY : number = Math.min( ...members.map( ( object : SvgDocument.ObjectNode ) : number => object.transform.y ) );
        const maxX : number = Math.max( ...members.map( ( object : SvgDocument.ObjectNode ) : number => object.transform.x + object.transform.width ) );
        const maxY : number = Math.max( ...members.map( ( object : SvgDocument.ObjectNode ) : number => object.transform.y + object.transform.height ) );

        // re-base each child so it draws relative to the group's origin, then build the group node
        const children : Array<SvgDocument.ObjectNode> = members.map( ( object : SvgDocument.ObjectNode ) : SvgDocument.ObjectNode => ( { ...object, transform: { ...object.transform, x: object.transform.x - minX, y: object.transform.y - minY } } ) );
        const group : SvgDocument.GroupNode =
        {
            id: makeId(), kind: SvgDocument.ObjectKind.GROUP, name: "Group", locked: false, hidden: false,
            transform: defaultTransform( minX, minY, maxX - minX, maxY - minY ), opacity: 1,
            conditionalVisibility: null, objects: children,
        };

        // remove the members and add the group in one commit
        const removed : SvgDocument.Doc = deleteObjects( current.doc, current.activePage, current.activeLayer, current.selectedIds );
        const grouped : SvgDocument.Doc = addObject( removed, current.activePage, current.activeLayer, group );
        dispatch( { type: SvgEditorActionType.SET_DOC, doc: grouped } );
        dispatch( { type: SvgEditorActionType.SELECT_OBJECTS, ids: [ group.id ] } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // the global keyboard shortcuts (reads the latest state via stateRef)
    function onKeyDown( event : KeyboardEvent ) : void
    {
        const meta : boolean = event.metaKey || event.ctrlKey;
        // undo / redo
        if( meta && event.key.toLowerCase() === "z" )
        {
            event.preventDefault();
            dispatch( { type: event.shiftKey ? SvgEditorActionType.REDO : SvgEditorActionType.UNDO } );
            return;
        }
        if( meta && event.key.toLowerCase() === "y" )
        {
            event.preventDefault();
            dispatch( { type: SvgEditorActionType.REDO } );
            return;
        }
        // group
        if( meta && event.key.toLowerCase() === "g" )
        {
            event.preventDefault();
            groupSelected();
            return;
        }
        // delete
        if( event.key === "Backspace" || event.key === "Delete" )
        {
            event.preventDefault();
            deleteSelected();
            return;
        }
        // tool switches (ignore when typing into a field)
        if( !meta ) onToolKey( event.key );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // map a bare key to a tool switch (T/V/R/Escape)
    function onToolKey( key : string ) : void
    {
        if( key === "t" || key === "T" ) dispatch( { type: SvgEditorActionType.SET_TOOL, tool: ToolMode.TEXT } );
        if( key === "v" || key === "V" || key === "Escape" ) dispatch( { type: SvgEditorActionType.SET_TOOL, tool: ToolMode.SELECT } );
        if( key === "r" || key === "R" ) dispatch( { type: SvgEditorActionType.SET_TOOL, tool: ToolMode.SHAPE } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    function openExport() : void  { setExporting( true ); }
    function closeExport() : void { setExporting( false ); }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // the active page (falls back to the first page)
    const page : SvgDocument.Page | null = state.doc !== null ? ( pageById( state.doc, state.activePage ) ?? state.doc.pages[ 0 ] ?? null ) : null;
    const scaledWidth : number = page !== null ? page.size.width * state.zoom : 0;
    const scaledHeight : number = page !== null ? page.size.height * state.zoom : 0;

    ////////////////////////////////////////////////////////////////////////////////////////////
    return  <SvgEditorContext.Provider value={ { state, dispatch } }>
                <Box sx={{ display: "flex", flexDirection: "column", height: "100%", bgcolor: "background.default" }}>
                    <SvgMainToolbar onExport={ openExport } saving={ saving } />
                    <SvgContextToolbar />

                    <Box sx={{ display: "flex", flexGrow: 1, minHeight: 0 }}>
                        { state.doc !== null && page !== null && <SvgLayersPanel doc={ state.doc } page={ page } /> }

                        <Box sx={{ display: "flex", flexDirection: "column", flexGrow: 1, minWidth: 0 }}>
                            {/* ruler corner + top ruler */}
                            <Stack direction="row" sx={{ height: 20 }}>
                                <Box sx={{ width: 20, height: 20, borderRight: 1, borderBottom: 1, borderColor: "divider", bgcolor: "background.paper" }} />
                                <RulerBar orientation="horizontal" length={ scaledWidth } unit={ page?.size.unit ?? SvgDocument.Unit.PT } zoom={ state.zoom } offset={ 0 } />
                            </Stack>
                            {/* left ruler + scrollable canvas */}
                            <Box sx={{ display: "flex", flexGrow: 1, minHeight: 0 }}>
                                <RulerBar orientation="vertical" length={ scaledHeight } unit={ page?.size.unit ?? SvgDocument.Unit.PT } zoom={ state.zoom } offset={ 0 } />
                                <Box sx={{ flexGrow: 1, minWidth: 0, overflow: "auto", display: "flex", justifyContent: "center", alignItems: "flex-start", p: 4, bgcolor: "action.hover" }}>
                                    { loading
                                        ? <CircularProgress size={ 28 } />
                                        : state.doc !== null && page !== null
                                            ? <SvgCanvas doc={ state.doc } page={ page } />
                                            : <Typography variant="body2" sx={{ color: "text.secondary" }}>{"No design loaded."}</Typography> }
                                </Box>
                            </Box>
                        </Box>

                        <SvgPropertyInspector />
                    </Box>

                    { state.doc !== null && page !== null && <SvgPagesPanel doc={ state.doc } page={ page } /> }
                </Box>

                { exporting && <ExportDialog open={ exporting } onClose={ closeExport } projectId={ props.projectId } /> }
                { snack && <SnackAlert message={ snack.message } severity={ snack.severity } onClose={ () : void => setSnack( null ) } /> }
            </SvgEditorContext.Provider>;
}

export namespace SvgDesignEditor
{
    export interface Props
    {
        projectId : string;
    }
}

export default SvgDesignEditor;
