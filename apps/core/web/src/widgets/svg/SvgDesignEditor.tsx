import AppModel from "@model/AppModel";
//
import React from "react";
import { JSX } from "react";

import { Box, CircularProgress, Stack, Typography } from "@mui/material";

import { SvgDocument, GetSvgCanvas, PostSvgRender, PutSvgCanvas } from "@repo/api";
import { RestfulService } from "@repo/endpoint";

import SnackAlert from "@widgets/core/SnackAlert";
import SvgService from "@model/service/SvgService";
import BrowserUtils from "@utils/BrowserUtils";
import { ensureFamiliesLoaded } from "@widgets/core/GoogleFonts";

import { SvgEditorContext } from "@widgets/svg/editor/SvgEditorContext";
import { svgEditorReducer } from "@widgets/svg/editor/svgEditorReducer";
import { SvgEditorState, SvgEditorAction, SvgEditorActionType, ToolMode, makeInitialState, makeId, defaultTransform, makeBlankDoc, makeBlankPage, DEFAULT_PAGE_SIZE, GOOGLE_FONTS_TOP_50 } from "@widgets/svg/editor/SvgEditorModel";
import { pageById, deleteObjects, addObject, replaceObject } from "@widgets/svg/editor/SvgDocOps";
import SvgCanvas from "@widgets/svg/editor/SvgCanvas";
import RulerBar from "@widgets/svg/editor/RulerBar";
import SvgLayersPanel from "@widgets/svg/panels/SvgLayersPanel";
import SvgPagesPanel from "@widgets/svg/panels/SvgPagesPanel";
import SvgPropertyInspector from "@widgets/svg/inspector/SvgPropertyInspector";
import SvgMainToolbar from "@widgets/svg/toolbar/SvgMainToolbar";
import SvgContextToolbar from "@widgets/svg/toolbar/SvgContextToolbar";
import ExportDialog from "@pages/media/dialogs/ExportDialog";
import { EmailImagePickerDialog } from "@widgets/email/EmailImagePickerDialog";
import SvgDocumentSettingsDialog from "@widgets/svg/dialogs/SvgDocumentSettingsDialog";
import SvgAssetPickerDialog from "@widgets/svg/dialogs/SvgAssetPickerDialog";
import SvgExitPrompt from "@widgets/svg/dialogs/SvgExitPrompt";
import AlertPrompt from "@widgets/core/AlertPrompt";

//
// SvgDesignEditor — the editor shell. Owns the reducer state (useReducer + SvgEditorContext.Provider), loads
// the project's doc on mount, autosaves on a 2-second debounce, and wires the keyboard shortcuts. Composes
// the toolbars, the layers panel, the ruled canvas, the property inspector, and the pages strip.
//
export const SvgDesignEditor = React.forwardRef<SvgDesignEditor.Handle, SvgDesignEditor.Props>( function SvgDesignEditor( props : SvgDesignEditor.Props, ref : React.ForwardedRef<SvgDesignEditor.Handle> ) : JSX.Element
{
    const appmodel : AppModel = AppModel.instance();
    const svc : SvgService = React.useMemo( () : SvgService => new SvgService( appmodel ), [ appmodel ] );

    const [ state, dispatch ] = React.useReducer( svgEditorReducer, undefined, makeInitialState );
    const [ loading, setLoading ] = React.useState<boolean>( true );
    const [ saving, setSaving ]   = React.useState<boolean>( false );
    const [ exporting, setExporting ]         = React.useState<boolean>( false );
    const [ imagePicker, setImagePicker ]     = React.useState<boolean>( false );
    const [ svgPicker, setSvgPicker ]         = React.useState<boolean>( false );
    const [ settingsOpen, setSettingsOpen ]   = React.useState<boolean>( false );
    const [ exitPromptOpen, setExitPromptOpen ]       = React.useState<boolean>( false );
    const [ recoverPromptOpen, setRecoverPromptOpen ] = React.useState<boolean>( false );
    const [ snack, setSnack ]     = React.useState<{ message : string; severity : SnackAlert.Severity } | null>( null );
    // measured scroll-area dimensions — used to size the rulers so they span the full content width/height
    const [ scrollAreaSize, setScrollAreaSize ] = React.useState<{ width : number; height : number }>( { width: 0, height: 0 } );
    // current scroll position of the scroll container — used to offset ruler tick 0 with the canvas position
    const [ scrollOffset, setScrollOffset ] = React.useState<{ x : number; y : number }>( { x: 0, y: 0 } );

    // a ref mirror of the latest state so the (once-registered) key handler reads current values
    const stateRef : React.MutableRefObject<SvgEditorState> = React.useRef<SvgEditorState>( state );
    stateRef.current = state;
    // ref to the scroll container so we can measure it for ruler sizing
    const scrollRef : React.MutableRefObject<HTMLDivElement | null> = React.useRef<HTMLDivElement | null>( null );
    // the recovered draft doc pending the user's yes/no choice in the recovery prompt
    const pendingRecoverDoc : React.MutableRefObject<SvgDocument.Doc | null> = React.useRef<SvgDocument.Doc | null>( null );
    // guards the local-draft recovery check to only run once, on the initial mount load (not on discard()'s reload)
    const hasCheckedRecovery : React.MutableRefObject<boolean> = React.useRef<boolean>( false );

    React.useEffect( componentLoaded, [] );
    React.useEffect( draftChanged, [ state.doc, state.dirtyFlag ] );
    React.useEffect( viewStateChanged, [ state.zoom, state.activePage ] );
    React.useEffect( statusChanged, [ state.dirtyFlag, saving ] );
    // no deps — always exposes the latest closures (save()/onCancel/openExport read live refs/state, so a
    // stale handle would risk acting on an outdated dirty flag when the host calls Cancel from outside)
    React.useImperativeHandle( ref, buildHandle );

    ////////////////////////////////////////////////////////////////////////////////////////////
    // track scroll position so rulers stay in sync with the canvas when the user scrolls or pans
    function onScrollAreaScroll( event : React.UIEvent<HTMLDivElement> ) : void
    {
        const el : HTMLDivElement = event.currentTarget;
        setScrollOffset( { x: el.scrollLeft, y: el.scrollTop } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // update stored scroll-area dimensions whenever the container resizes — drives ruler lengths
    function onScrollAreaResize( entries : Array<ResizeObserverEntry> ) : void
    {
        const entry : ResizeObserverEntry | undefined = entries[ 0 ];
        if( entry === undefined ) return;
        setScrollAreaSize( { width: entry.contentRect.width, height: entry.contentRect.height } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // on mount: load the project doc + register keyboard shortcuts + observe the scroll container for ruler
    // sizing + preload the font picker's families — BEFORE any text object is selected, so canvas text renders
    // in its real font from the start instead of a fallback serif until the user first clicks a text object
    // (the browser repaints live text automatically once each @font-face resolves; no forced re-render needed)
    function componentLoaded() : () => void
    {
        void load();
        ensureFamiliesLoaded( GOOGLE_FONTS_TOP_50 );
        window.addEventListener( "keydown", onKeyDown );
        const observer : ResizeObserver = new ResizeObserver( onScrollAreaResize );
        if( scrollRef.current !== null ) observer.observe( scrollRef.current );
        return () : void =>
        {
            window.removeEventListener( "keydown", onKeyDown );
            observer.disconnect();
        };
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // fetch the project's editable doc; when no doc exists yet (new or pre-SVG project) seed
    // a blank Letter canvas and persist it so subsequent loads succeed
    async function load() : Promise<void>
    {
        setLoading( true );
        const reply : RestfulService.Reply<GetSvgCanvas.Response> = await svc.getCanvas( props.projectId );
        if( reply.ok && reply.data )
        {
            // normalize: add doc.pageSize if missing (older saved docs may not have it)
            const rawDoc : SvgDocument.Doc = reply.data.doc;
            const resolvedPageSize : SvgDocument.PageSize = rawDoc.pageSize ?? rawDoc.pages[ 0 ]?.size ?? DEFAULT_PAGE_SIZE;
            const doc : SvgDocument.Doc = rawDoc.pageSize !== undefined ? rawDoc : { ...rawDoc, pageSize: resolvedPageSize };
            setLoading( false );
            dispatch( { type: SvgEditorActionType.LOAD_DOC, doc } );
            // restore saved zoom + page (must come after LOAD_DOC which resets them)
            const saved : { zoom : number; activePage : string } | null = loadViewState();
            if( saved !== null )
            {
                dispatch( { type: SvgEditorActionType.SET_ZOOM, zoom: saved.zoom } );
                const pageExists : boolean = doc.pages.some( ( page : SvgDocument.Page ) : boolean => page.id === saved.activePage );
                if( pageExists ) dispatch( { type: SvgEditorActionType.SET_ACTIVE_PAGE, pageId: saved.activePage } );
            }
            checkForRecoverableDraft();
            return;
        }
        // no doc in S3 yet — seed a blank Letter canvas and immediately persist it
        const blank : SvgDocument.Doc = makeBlankDoc( props.projectId );
        await svc.putCanvas( props.projectId, blank );
        setLoading( false );
        dispatch( { type: SvgEditorActionType.LOAD_DOC, doc: blank } );
        checkForRecoverableDraft();
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // on the initial mount load only (not on discard()'s reload) — if a crash-recovery draft is cached
    // for this project, hold it and prompt the user to recover it or drop it
    function checkForRecoverableDraft() : void
    {
        if( hasCheckedRecovery.current ) return;
        hasCheckedRecovery.current = true;
        const json : string | null = localStorage.getItem( draftKey() );
        if( json === null ) return;
        try
        {
            pendingRecoverDoc.current = JSON.parse( json ) as SvgDocument.Doc;
            setRecoverPromptOpen( true );
        }
        catch { clearDraft(); }
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // report the current dirty/saving status to the host (MediaStudio's title-area Save button) — there is
    // no server autosave any more: the server is only written to on an explicit Save (button, ⌘S, or a
    // resolved exit/recover prompt); ongoing edits are only cached locally, see draftChanged() below
    function statusChanged() : void
    {
        props.onStatusChange?.( { dirty: state.dirtyFlag, saving } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // the imperative actions exposed to the host title bar (Save / Cancel / Export buttons live in
    // MediaStudio's banner now, not in this component's own toolbar)
    function buildHandle() : SvgDesignEditor.Handle
    {
        return { save: () : Promise<boolean> => save(), cancel: onCancel, openExport };
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // crash-recovery draft cache — a fast (500ms), network-independent local backup distinct from the 2s
    // server autosave above; only WRITES here — clearing happens explicitly at every point the doc becomes
    // safe (successful save, discard, or a resolved recovery prompt) so there's no clear/write race on exit
    function draftChanged() : void | ( () => void )
    {
        if( !state.dirtyFlag ) return;
        const timer : ReturnType<typeof setTimeout> = setTimeout( writeDraft, 500 );
        return () : void => clearTimeout( timer );
    }
    function draftKey() : string { return `svg-editor-draft-${ props.projectId }`; }
    function writeDraft() : void
    {
        const doc : SvgDocument.Doc | null = stateRef.current.doc;
        if( doc === null ) return;
        localStorage.setItem( draftKey(), JSON.stringify( doc ) );
    }
    function clearDraft() : void { localStorage.removeItem( draftKey() ); }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // persist zoom + active-page to localStorage (debounced 1 s) so re-opening the doc restores the view
    function viewStateChanged() : void | ( () => void )
    {
        if( state.doc === null ) return;
        const timer : ReturnType<typeof setTimeout> = setTimeout( saveViewState, 1000 );
        return () : void => clearTimeout( timer );
    }
    function saveViewState() : void
    {
        const current : SvgEditorState = stateRef.current;
        localStorage.setItem(
            `svg-editor-view-${ props.projectId }`,
            JSON.stringify( { zoom: current.zoom, activePage: current.activePage } ),
        );
    }
    function loadViewState() : { zoom : number; activePage : string } | null
    {
        try
        {
            const json : string | null = localStorage.getItem( `svg-editor-view-${ props.projectId }` );
            return json !== null ? ( JSON.parse( json ) as { zoom : number; activePage : string } ) : null;
        }
        catch { return null; }
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // persist the current doc, then clear the dirty flag (branch on the reply — fetch never throws);
    // returns whether the save succeeded so callers (the exit prompt) can decide whether it's safe to leave.
    // `overrideDoc` lets a caller save a doc it just dispatched without waiting on a re-render to land in
    // stateRef (dispatch doesn't take effect until the next render, so reading stateRef right after a
    // same-tick dispatch would still see the PRIOR doc)
    async function save( overrideDoc? : SvgDocument.Doc ) : Promise<boolean>
    {
        const doc : SvgDocument.Doc | null = overrideDoc ?? stateRef.current.doc;
        if( doc === null ) return false;
        setSaving( true );
        const reply : RestfulService.Reply<PutSvgCanvas.Response> = await svc.putCanvas( props.projectId, doc );
        setSaving( false );
        if( reply.ok )
        {
            dispatch( { type: SvgEditorActionType.CLEAR_DIRTY } );
            clearDraft();
            return true;
        }
        setSnack( { message: "Autosave failed — retrying on the next change.", severity: "warning" } );
        return false;
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
    // cut — copy selected objects to the clipboard then delete them
    function cutSelected() : void
    {
        const current : SvgEditorState = stateRef.current;
        if( current.doc === null || current.selectedIds.length === 0 ) return;
        dispatch( { type: SvgEditorActionType.COPY } );
        deleteSelected();
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // select all objects on the active layer
    function selectAll() : void
    {
        const current : SvgEditorState = stateRef.current;
        if( current.doc === null ) return;
        const page  : SvgDocument.Page  | undefined = pageById( current.doc, current.activePage );
        const layer : SvgDocument.Layer | undefined = page?.layers.find( ( candidate : SvgDocument.Layer ) : boolean => candidate.id === current.activeLayer );
        const ids   : Array<string> = layer?.objects.map( ( object : SvgDocument.ObjectNode ) : string => object.id ) ?? [];
        if( ids.length > 0 ) dispatch( { type: SvgEditorActionType.SELECT_OBJECTS, ids } );
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
    // immediately save to S3 on explicit user request (⌘S or toolbar button)
    function onSave() : void { void save(); }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // discard: reload the doc from S3, discarding any unsaved changes (and the local crash-recovery draft)
    async function discard() : Promise<void>
    {
        await load();
        clearDraft();
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // Cancel — exits the editor immediately if clean, otherwise asks the user how to handle unsaved work
    function onCancel() : void
    {
        if( state.dirtyFlag ) { setExitPromptOpen( true ); return; }
        props.onClose?.();
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // the exit prompt's "Save & Close" — only actually leaves once the save succeeds
    async function onExitSave() : Promise<boolean>
    {
        const saved : boolean = await save();
        if( saved ) props.onClose?.();
        return saved;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // the exit prompt's "Discard" — reverts to the last saved version, then leaves
    async function onExitDiscard() : Promise<boolean>
    {
        await discard();
        props.onClose?.();
        return true;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // the exit prompt's "Keep Editing" — just dismiss the prompt
    function onExitKeepEditing() : void { setExitPromptOpen( false ); }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // the recovery prompt's "Recover" — load the cached draft as a dirty edit, then save it to the server
    async function onRecoverYes() : Promise<boolean>
    {
        const recovered : SvgDocument.Doc | null = pendingRecoverDoc.current;
        if( recovered === null ) { setRecoverPromptOpen( false ); return true; }
        dispatch( { type: SvgEditorActionType.SET_DOC, doc: recovered } );
        await save( recovered );
        setRecoverPromptOpen( false );
        return true;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // the recovery prompt's "Discard" — drop the cached draft, keep the already-loaded server version
    function onRecoverNo() : void
    {
        clearDraft();
        setRecoverPromptOpen( false );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // the recovery AlertPrompt's single action callback — dispatches to the yes/no handlers above
    async function onRecoverAction( action : AlertPrompt.Action ) : Promise<void>
    {
        if( action === AlertPrompt.Action.YES ) { await onRecoverYes(); return; }
        onRecoverNo();
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // the global keyboard shortcuts (reads the latest state via stateRef)
    function onKeyDown( event : KeyboardEvent ) : void
    {
        // let text fields handle their own keyboard events (backspace, arrow keys, etc.)
        const tag : string = ( document.activeElement?.tagName ?? "" ).toLowerCase();
        if( tag === "textarea" || tag === "input" ) return;
        const meta : boolean = event.metaKey || event.ctrlKey;
        // save
        if( meta && event.key.toLowerCase() === "s" )
        {
            event.preventDefault();
            onSave();
            return;
        }
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
        // cut / copy / paste / select-all
        if( meta && event.key.toLowerCase() === "x" )
        {
            event.preventDefault();
            cutSelected();
            return;
        }
        if( meta && event.key.toLowerCase() === "c" )
        {
            event.preventDefault();
            dispatch( { type: SvgEditorActionType.COPY } );
            return;
        }
        if( meta && event.key.toLowerCase() === "v" )
        {
            event.preventDefault();
            dispatch( { type: SvgEditorActionType.PASTE } );
            return;
        }
        if( meta && event.key.toLowerCase() === "a" )
        {
            event.preventDefault();
            selectAll();
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
        if( key === "v" || key === "V" || key === "Escape" )
        {
            dispatch( { type: SvgEditorActionType.SET_TOOL, tool: ToolMode.SELECT } );
            dispatch( { type: SvgEditorActionType.SET_BEZIER_EDIT, nodeId: null } );
        }
        if( key === "r" || key === "R" ) dispatch( { type: SvgEditorActionType.SET_TOOL, tool: ToolMode.SHAPE } );
        if( key === "e" || key === "E" ) dispatch( { type: SvgEditorActionType.SET_TOOL, tool: ToolMode.ELLIPSE } );
        if( key === "l" || key === "L" ) dispatch( { type: SvgEditorActionType.SET_TOOL, tool: ToolMode.LINE } );
        if( key === "p" || key === "P" ) dispatch( { type: SvgEditorActionType.SET_TOOL, tool: ToolMode.PEN } );
        if( key === "o" || key === "O" ) dispatch( { type: SvgEditorActionType.SET_TOOL, tool: ToolMode.POLYGON } );
        if( key === "b" || key === "B" ) dispatch( { type: SvgEditorActionType.SET_TOOL, tool: ToolMode.BEZIER } );
    }

    // kick off an export render — saves the job to localStorage so Media › Downloads can track it
    async function startExport( settings : SvgDocument.ExportSettings ) : Promise<void>
    {
        const reply : RestfulService.Reply<PostSvgRender.Response> = await svc.render( props.projectId, settings );
        if( !reply.ok || !reply.data )
        {
            setSnack( { message: "Could not start export.", severity: "error" } );
            return;
        }
        const jobId  : string = reply.data.jobId;
        const stored : Array<{ jobId : string; projectId : string; projectName : string; format : string; startedAt : string }> = JSON.parse( localStorage.getItem( "svg-render-jobs" ) ?? "[]" );
        stored.push( { jobId, projectId: props.projectId, projectName: props.projectName ?? "Design", format: settings.format, startedAt: new Date().toISOString() } );
        localStorage.setItem( "svg-render-jobs", JSON.stringify( stored ) );
        setSnack( { message: "Export started — check Media › Downloads.", severity: "success" } );
    }

    // called by ExportDialog when the user clicks Export — closes the dialog and fires the job in the background
    function onExport( settings : SvgDocument.ExportSettings ) : void
    {
        closeExport();
        void startExport( settings );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    function openExport() : void  { setExporting( true ); }
    function closeExport() : void { setExporting( false ); }

    ////////////////////////////////////////////////////////////////////////////////////////////
    function openImagePicker() : void  { setImagePicker( true ); }
    function closeImagePicker() : void { setImagePicker( false ); }

    // called when the user confirms a pick in the image picker — measures the natural image size, then adds the
    // asset + an ImageNode scaled to fit the active page (never scaled up; 1px treated as 1pt)
    async function onImagePicked( pick : EmailImagePickerDialog.Pick ) : Promise<void>
    {
        const capturedPage : SvgDocument.Page | null = page;
        if( stateRef.current.doc === null || capturedPage === null ) return;

        // close the picker immediately so the modal isn't blocking while the image loads
        setImagePicker( false );

        // measure natural dimensions; fall back to 200×200 if the URL fails to load
        const natural : { width : number; height : number } = await BrowserUtils.measureImage( pick.url );

        // re-read state after the async gap in case the active page/layer changed
        const latest : SvgEditorState = stateRef.current;
        if( latest.doc === null ) return;

        // register the asset in doc.assets (skip if the guid is already there)
        const assetExists : boolean = latest.doc.assets.some( ( a : SvgDocument.Asset ) : boolean => a.id === pick.guid );
        const asset : SvgDocument.Asset =
        {
            id: pick.guid, kind: SvgDocument.AssetKind.IMAGE, name: pick.name,
            mediaId: pick.guid, cdnUrl: pick.url, embedded: null, mimeType: "image/*",
        };
        const docWithAsset : SvgDocument.Doc = assetExists
            ? latest.doc
            : { ...latest.doc, assets: [ ...latest.doc.assets, asset ] };

        // scale natural dimensions (1px = 1pt) down to fit within the page with a margin on each side
        const MARGIN_PT : number = 32;
        const maxWidth  : number = capturedPage.size.width  - MARGIN_PT * 2;
        const maxHeight : number = capturedPage.size.height - MARGIN_PT * 2;
        const imgWidth  : number = natural.width  > 0 ? natural.width  : 200;
        const imgHeight : number = natural.height > 0 ? natural.height : 200;
        const scale     : number = Math.min( 1, maxWidth / imgWidth, maxHeight / imgHeight );
        const nodeWidth  : number = Math.round( imgWidth  * scale );
        const nodeHeight : number = Math.round( imgHeight * scale );

        const DEFAULT_FILTERS : SvgDocument.ImageFilters =
        {
            brightness: 0, contrast: 0, saturation: 0, blur: 0, colorOverlay: null,
        };
        const imageNode : SvgDocument.ImageNode =
        {
            id: makeId(), kind: SvgDocument.ObjectKind.IMAGE, name: pick.name,
            locked: false, hidden: false, opacity: 1, conditionalVisibility: null,
            transform: defaultTransform( MARGIN_PT, MARGIN_PT, nodeWidth, nodeHeight ),
            assetId: pick.guid, crop: null, aspectLocked: false, mask: null, frame: null, filters: DEFAULT_FILTERS,
        };
        const nextDoc : SvgDocument.Doc = addObject( docWithAsset, latest.activePage, latest.activeLayer, imageNode );
        dispatch( { type: SvgEditorActionType.SET_DOC, doc: nextDoc } );
        dispatch( { type: SvgEditorActionType.SELECT_OBJECTS, ids: [ imageNode.id ] } );
        dispatch( { type: SvgEditorActionType.SET_TOOL, tool: ToolMode.SELECT } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    function openSvgPicker() : void  { setSvgPicker( true ); }
    function closeSvgPicker() : void { setSvgPicker( false ); }

    // read an SVG fragment's own size (viewBox, else width/height attrs) for initial placement — a much
    // smaller concern than the export compiler's inlineSvgMarkup (which also remaps content into a nested
    // <svg>), so kept as its own small local parser rather than sharing that internal helper
    function parseSvgSize( markup : string ) : { width : number; height : number }
    {
        const openTagMatch : RegExpMatchArray | null = markup.match( /<svg\b([^>]*)>/i );
        if( openTagMatch === null ) return { width: 100, height: 100 };
        const attrs : string = openTagMatch[ 1 ];
        const viewBoxMatch : RegExpMatchArray | null = attrs.match( /viewBox\s*=\s*["']([^"']+)["']/i );
        if( viewBoxMatch !== null )
        {
            const parts : Array<string> = viewBoxMatch[ 1 ].trim().split( /\s+/ );
            if( parts.length === 4 ) return { width: Number( parts[ 2 ] ) || 100, height: Number( parts[ 3 ] ) || 100 };
        }
        const widthMatch  : RegExpMatchArray | null = attrs.match( /(?<!view)width\s*=\s*["']([\d.]+)/i );
        const heightMatch : RegExpMatchArray | null = attrs.match( /(?<!view)height\s*=\s*["']([\d.]+)/i );
        return { width: widthMatch !== null ? Number( widthMatch[ 1 ] ) : 100, height: heightMatch !== null ? Number( heightMatch[ 1 ] ) : 100 };
    }

    // called when the user confirms a pick in the SVG picker — the markup always arrives already sanitized
    // (client-side pass for file imports; server-side for library/browse picks), so it's embedded verbatim
    async function onSvgPicked( pick : SvgAssetPickerDialog.Pick ) : Promise<void>
    {
        const capturedPage : SvgDocument.Page | null = page;
        if( stateRef.current.doc === null || capturedPage === null ) return;

        setSvgPicker( false );

        const latest : SvgEditorState = stateRef.current;
        if( latest.doc === null ) return;

        // a library/browse pick reuses its library assetId as the doc-local asset id (so placing the same
        // graphic twice reuses one Asset entry, same dedupe as onImagePicked); a file import always gets a
        // fresh id since it has no stable library identity
        const docAssetId  : string = pick.assetId ?? makeId();
        const assetExists : boolean = latest.doc.assets.some( ( a : SvgDocument.Asset ) : boolean => a.id === docAssetId );
        const asset : SvgDocument.Asset =
        {
            // mediaId is a Media.Asset guid contract elsewhere (e.g. the export dialog's DPI check calls
            // GetAsset(mediaId)) — only set it when the pick is genuinely media-backed; assetId alone may be
            // an svg-assets row id, which GetAsset would 404 on
            id: docAssetId, kind: SvgDocument.AssetKind.SVG, name: pick.name,
            mediaId: pick.mediaGuid ?? null, cdnUrl: null, embedded: pick.svg, mimeType: "image/svg+xml",
        };
        const docWithAsset : SvgDocument.Doc = assetExists
            ? latest.doc
            : { ...latest.doc, assets: [ ...latest.doc.assets, asset ] };

        // scale the SVG's own size (1px = 1pt) down to fit within the page with a margin on each side
        const MARGIN_PT : number = 32;
        const maxWidth  : number = capturedPage.size.width  - MARGIN_PT * 2;
        const maxHeight : number = capturedPage.size.height - MARGIN_PT * 2;
        const natural   : { width : number; height : number } = parseSvgSize( pick.svg );
        const scale     : number = Math.min( 1, maxWidth / natural.width, maxHeight / natural.height );
        const nodeWidth  : number = Math.round( natural.width  * scale );
        const nodeHeight : number = Math.round( natural.height * scale );

        const DEFAULT_FILTERS : SvgDocument.ImageFilters =
        {
            brightness: 0, contrast: 0, saturation: 0, blur: 0, colorOverlay: null,
        };
        const imageNode : SvgDocument.ImageNode =
        {
            id: makeId(), kind: SvgDocument.ObjectKind.IMAGE, name: pick.name,
            locked: false, hidden: false, opacity: 1, conditionalVisibility: null,
            transform: defaultTransform( MARGIN_PT, MARGIN_PT, nodeWidth, nodeHeight ),
            assetId: docAssetId, crop: null, aspectLocked: false, mask: null, frame: null, filters: DEFAULT_FILTERS,
        };
        const nextDoc : SvgDocument.Doc = addObject( docWithAsset, latest.activePage, latest.activeLayer, imageNode );
        dispatch( { type: SvgEditorActionType.SET_DOC, doc: nextDoc } );
        dispatch( { type: SvgEditorActionType.SELECT_OBJECTS, ids: [ imageNode.id ] } );
        dispatch( { type: SvgEditorActionType.SET_TOOL, tool: ToolMode.SELECT } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // the active page (falls back to the first page)
    const page : SvgDocument.Page | null = state.doc !== null ? ( pageById( state.doc, state.activePage ) ?? state.doc.pages[ 0 ] ?? null ) : null;
    const scaledWidth : number = page !== null ? page.size.width * state.zoom : 0;
    const scaledHeight : number = page !== null ? page.size.height * state.zoom : 0;
    // ruler lengths: the measured scroll-area size so ticks span the full visible area (fallback: canvas + 100px margin)
    const rulerHLength : number = scrollAreaSize.width  > 0 ? scrollAreaSize.width  : scaledWidth  + 100;
    const rulerVLength : number = scrollAreaSize.height > 0 ? scrollAreaSize.height : scaledHeight + 100;
    // ruler offsets: 32px (p:4 padding) minus the current scroll position — keeps tick 0 at the canvas origin
    const rulerHOffset : number = 32 - scrollOffset.x;
    const rulerVOffset : number = 32 - scrollOffset.y;

    ////////////////////////////////////////////////////////////////////////////////////////////
    return  <SvgEditorContext.Provider value={ { state, dispatch } }>
                <Box sx={{ display: "flex", flexDirection: "column", height: "100%", bgcolor: "background.default" }}>
                    <SvgMainToolbar onInsertImage={ openImagePicker } onInsertSvg={ openSvgPicker } saving={ saving } />
                    <SvgContextToolbar />

                    <Box sx={{ display: "flex", flexGrow: 1, minHeight: 0 }}>
                        { state.doc !== null && page !== null && <SvgLayersPanel doc={ state.doc } page={ page } /> }

                        <Box sx={{ display: "flex", flexDirection: "column", flexGrow: 1, minWidth: 0 }}>
                            {/* ruler corner + top ruler — ruler spans the full scroll-area width */}
                            <Stack direction="row" sx={{ height: 20 }}>
                                <Box sx={{ width: 20, height: 20, borderRight: 1, borderBottom: 1, borderColor: "divider", bgcolor: "background.paper" }} />
                                <RulerBar orientation="horizontal" length={ rulerHLength } unit={ page?.size.unit ?? SvgDocument.Unit.PT } zoom={ state.zoom } offset={ rulerHOffset } />
                            </Stack>
                            {/* left ruler + scrollable canvas */}
                            <Box sx={{ display: "flex", flexGrow: 1, minHeight: 0 }}>
                                <RulerBar orientation="vertical" length={ rulerVLength } unit={ page?.size.unit ?? SvgDocument.Unit.PT } zoom={ state.zoom } offset={ rulerVOffset } />
                                <Box ref={ scrollRef } onScroll={ onScrollAreaScroll }
                                     onClick={ ( event : React.MouseEvent<HTMLDivElement> ) : void =>
                                     {
                                         if( event.target !== event.currentTarget ) return;
                                         dispatch( { type: SvgEditorActionType.CLEAR_SELECTION } );
                                         dispatch( { type: SvgEditorActionType.SET_CROP_NODE, nodeId: null } );
                                     } }
                                     sx={{ flexGrow: 1, minWidth: 0, overflow: "auto", display: "flex", alignItems: "flex-start", p: 4, bgcolor: "action.hover" }}>
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

                    { state.doc !== null && page !== null && <SvgPagesPanel doc={ state.doc } page={ page } onOpenSettings={ () : void => setSettingsOpen( true ) } /> }
                </Box>

                { exporting    && <ExportDialog open={ exporting } doc={ state.doc } onClose={ closeExport } onExport={ onExport } /> }
                { imagePicker  && <EmailImagePickerDialog onPick={ onImagePicked } onClose={ closeImagePicker } /> }
                { svgPicker    && <SvgAssetPickerDialog open={ svgPicker } onPick={ ( pick : SvgAssetPickerDialog.Pick ) : void => void onSvgPicked( pick ) } onClose={ closeSvgPicker } /> }
                <SvgDocumentSettingsDialog open={ settingsOpen } onClose={ () : void => setSettingsOpen( false ) } />
                { exitPromptOpen &&
                    <SvgExitPrompt onSave={ onExitSave } onDiscard={ onExitDiscard } onClose={ onExitKeepEditing } /> }
                { recoverPromptOpen &&
                    <AlertPrompt id="svg-recover-draft"
                                 type={ AlertPrompt.Type.QUESTION }
                                 title={"Recover unsaved changes?"}
                                 message={"This design has unsaved changes from a previous session that were never synced."}
                                 secondary={"Recover them and save, or discard them and keep the last saved version."}
                                 yesText={"Recover"} noText={"Discard"}
                                 onAction={ onRecoverAction } /> }
                { snack && <SnackAlert message={ snack.message } severity={ snack.severity } onClose={ () : void => setSnack( null ) } /> }
            </SvgEditorContext.Provider>;
} );

export namespace SvgDesignEditor
{
    export interface Props
    {
        projectId       : string;
        projectName?    : string;   // displayed in Media › Downloads next to each export job
        onClose?        : () => void;   // Cancel — return to the project list (host-supplied; e.g. deselect)
        onStatusChange? : ( status : Status ) => void;   // reports dirty/saving so a host-owned title bar can drive its Save/Cancel buttons
    }

    // the live save-state a host title bar needs to enable/disable its own Save button
    export interface Status
    {
        dirty  : boolean;
        saving : boolean;
    }

    // imperative actions a host title bar triggers from outside (Save / Cancel / Export live in MediaStudio's banner, not this component's own toolbar)
    export interface Handle
    {
        save       : () => Promise<boolean>;
        cancel     : () => void;
        openExport : () => void;
    }
}

export default SvgDesignEditor;
