import AppModel from "@model/AppModel";
//
import React from 'react';
import { JSX } from "react";

import { Box, Button, Chip, CircularProgress, Stack, Tooltip, Typography, useTheme } from "@mui/material";
import { Theme } from "@mui/material/styles";
import ImageOutlinedIcon      from '@mui/icons-material/ImageOutlined';
import TravelExploreOutlinedIcon from '@mui/icons-material/TravelExploreOutlined';
import SaveOutlinedIcon       from '@mui/icons-material/SaveOutlined';
import LockOutlinedIcon       from '@mui/icons-material/LockOutlined';
import CloseOutlinedIcon      from '@mui/icons-material/CloseOutlined';
import RestoreOutlinedIcon    from '@mui/icons-material/RestoreOutlined';
import CropOutlinedIcon       from '@mui/icons-material/CropOutlined';
import CloudDoneOutlinedIcon  from '@mui/icons-material/CloudDoneOutlined';
import CloudSyncOutlinedIcon  from '@mui/icons-material/CloudSyncOutlined';
import CloudQueueOutlinedIcon from '@mui/icons-material/CloudQueueOutlined';

import { Tldraw, Editor, getSnapshot, loadSnapshot, AssetRecordType, createShapeId } from 'tldraw';
import type { TLAssetId, TLAsset, TLShapeId } from 'tldraw';
import 'tldraw/tldraw.css';

import { Media, StudioProject, PatchAsset, GetMediaUrl, PostUpload, PostUploadComplete, PostAssetReplace, PatchStudioProject, GetStudioCanvas, PutStudioCanvas, GetCampaign, Account } from '@repo/api';
import { RestfulService } from '@repo/endpoint';

import LocaleService        from '@model/service/LocaleService';
import SnackAlert           from '@widgets/core/SnackAlert';
import SelectInput          from '@widgets/core/SelectInput';
import StudioLibraryPickerDialog from '@pages/media/studio/StudioLibraryPickerDialog';
import StudioProvidersDialog     from '@pages/media/studio/StudioProvidersDialog';
import StudioPageSetupDialog     from '@pages/media/studio/image/StudioPageSetupDialog';
import StudioExitPrompt          from '@pages/media/studio/image/StudioExitPrompt';
import { STUDIO_EDITOR_COMPONENTS } from '@pages/media/studio/image/StudioEditorUi';
import { StudioBrandContext } from '@pages/media/studio/image/StudioBrandContext';
import Pusher from "@widgets/core/Pusher";

//
// StudioImageEditor — the image-composition surface for an IMAGE Studio project, built on tldraw. tldraw owns
// the canvas + drawing tools; the surrounding chrome is MUI (theme-synced). Persistence is TWO-TIER: every
// edit writes localStorage instantly (crash-safe on-device), and a lower-cadence background sync PUTs the
// snapshot to the server (DDB record + S3 canvas). The footer shows "Saved locally" vs "Synced HH:MM"; a
// project opens READ-ONLY and the Edit button unlocks it. "Revert to last saved" reloads the server copy.
// "Save to Library" renders the page to a library IMAGE asset (create first time, then update-in-place).
//
export function StudioImageEditor( props : StudioImageEditor.Props ) : JSX.Element
{
    const appmodel : AppModel = AppModel.instance();
    const theme : Theme = useTheme();

    const [saveState,setSaveState]   = React.useState< StudioImageEditor.SaveState >( StudioImageEditor.SaveState.IDLE );
    const [syncedAt,setSyncedAt]     = React.useState< string | null >( null );
    const [libraryOpen,setLibraryOpen] = React.useState< boolean >( false );
    const [providersOpen,setProvidersOpen] = React.useState< boolean >( false );
    const [readonlyState,setReadonlyState] = React.useState< boolean >( true );    // local edit-mode fallback (uncontrolled)
    const [saving,setSaving]         = React.useState< boolean >( false );   // save-to-library in progress
    const [saveFormat,setSaveFormat] = React.useState< "png" | "jpeg" >( "png" );   // raster format for Save to Library
    const [snack,setSnack]           = React.useState< { message : string; severity : SnackAlert.Severity } | null >( null );
    const [setupOpen,setSetupOpen]   = React.useState< boolean >( false );   // the Page Setup dialog
    const [exitPromptOpen,setExitPromptOpen] = React.useState< boolean >( false );   // unsaved-changes guard on Cancel
    const [campaignPalette,setCampaignPalette] = React.useState< Array<string> >( [] );   // the project's campaign brand colors (for the editor's Brand panel)
    const [campaignFonts,setCampaignFonts]     = React.useState< Array<Account.BrandFont> >( [] );   // the project's campaign brand fonts
    const [pageSpec,setPageSpec]     = React.useState< StudioProject.PageSpec >( () => props.project.page ?? { ...StudioProject.DEFAULT_PAGE } );

    const editorRef    = React.useRef< Editor | null >( null );
    const localTimer   = React.useRef< ReturnType<typeof setTimeout> | null >( null );
    const syncTimer    = React.useRef< ReturnType<typeof setTimeout> | null >( null );
    const firstDirtyAt = React.useRef< number | null >( null );   // for the max-wait server flush during continuous edits
    const dirty        = React.useRef< boolean >( false );        // unsynced changes exist
    const latestJson   = React.useRef< string | null >( null );   // last captured snapshot JSON (survives teardown)
    const hydrating    = React.useRef< boolean >( true );         // suppress autosave while restoring on mount

    // edit mode is CONTROLLED by the parent when `editing` is passed (the Edit button lives in the studio
    // banner, on the title line); otherwise it falls back to the local read-only state
    const readonly : boolean = props.editing === undefined ? readonlyState : !props.editing;

    // the per-project local canvas cache key (the component is remounted per project, so this is stable here)
    const storageKey : string = `${ StudioImageEditor.STORAGE_PREFIX }${ props.project.id }`;
    // a DETERMINISTIC id for this project's page frame — so we always resize/rename the SAME frame (never a dup)
    const pageFrameId : TLShapeId = createShapeId( `page-${ props.project.id }` );

    ////////////////////////////////////////////////////////////////////////////////////////////
    // keep tldraw's own read-only flag in sync with the effective edit mode (covers banner-driven changes)
    React.useEffect( () : void => { editorRef.current?.updateInstanceState( { isReadonly: readonly } ); }, [ readonly ] );

    ////////////////////////////////////////////////////////////////////////////////////////////
    // on unmount: flush any unsynced work to the server (best-effort, from the captured JSON) + clear timers
    React.useEffect( () : ( () => void ) =>
    {
        return () : void =>
        {
            if( localTimer.current !== null ) clearTimeout( localTimer.current );
            if( syncTimer.current !== null ) clearTimeout( syncTimer.current );
            if( dirty.current && latestJson.current !== null ) void syncServer();
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [] );

    ////////////////////////////////////////////////////////////////////////////////////////////
    // load the project's CAMPAIGN brand palette (if it belongs to a campaign) for the editor's Brand color panel
    React.useEffect( loadCampaignPalette, [] );

    function loadCampaignPalette() : void { void fetchCampaignPalette(); }

    async function fetchCampaignPalette() : Promise<void>
    {
        const campaignId : string | undefined = props.project.campaignId;
        if( !campaignId ) return;
        const reply : RestfulService.Reply<GetCampaign.Response> = await appmodel.server.fetch( new GetCampaign( campaignId ) );
        if( !reply.ok || !reply.data ) return;
        setCampaignPalette( reply.data.palette ?? [] );
        setCampaignFonts( reply.data.fonts ?? [] );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // tldraw is ready — keep the handle, start LOCKED, wire autosave, then hydrate the canvas
    function onMount( editor : Editor ) : ( () => void )
    {
        editorRef.current = editor;
        editor.updateInstanceState( { isReadonly: true } );
        // autosave: react to document changes the USER made (not our own restore / camera moves)
        const dispose : () => void = editor.store.listen( scheduleSave, { scope: "document", source: "user" } );
        // keep all content INSIDE the page frame: a newly-created page-root shape (drawn geometry, etc.) is
        // reparented into the frame, so z-order (send-to-back / bring-to-front) stays on the page and a shape
        // never falls BEHIND the page boundary. (Restored shapes during hydrate are left alone.)
        const reparent : () => void = editor.sideEffects.registerAfterCreateHandler( "shape", ( shape ) : void =>
        {
            if( hydrating.current || shape.id === pageFrameId || shape.type === "frame" ) return;
            if( !String( shape.parentId ).startsWith( "page:" ) ) return;   // already parented into a shape (the frame)
            if( editor.getShape( pageFrameId ) === undefined ) return;      // no page frame yet
            editor.reparentShapes( [ shape.id ], pageFrameId );
            // reparenting carries the shape's PAGE-level fractional index into the frame, where it can sort
            // BELOW existing frame children (e.g. a placed image) and vanish — a freshly drawn shape must sit
            // on top, so re-stack it to the front of the frame's children after the move.
            editor.bringToFront( [ shape.id ] );
        } );
        void hydrate( editor );
        return () : void => { dispose(); reparent(); };
    }

    // restore the canvas: prefer the local cache (may hold unsynced/crash-recovered edits), else the server copy
    async function hydrate( editor : Editor ) : Promise<void>
    {
        hydrating.current = true;
        const cached : string = appmodel.localStorage.get( storageKey ) ?? "";
        if( cached !== "" )
        {
            try { loadSnapshot( editor.store, JSON.parse( cached ) ); latestJson.current = cached; }
            catch { /* ignore a corrupt cache */ }
        }
        else
        {
            // no local cache → pull the last synced snapshot from the server
            const reply : RestfulService.Reply<GetStudioCanvas.Response> = await appmodel.server.fetch( new GetStudioCanvas( props.project.id ) );
            if( reply.ok && reply.data && reply.data.canvas )
            {
                try { loadSnapshot( editor.store, JSON.parse( reply.data.canvas ) ); latestJson.current = reply.data.canvas; }
                catch { /* ignore a corrupt payload */ }
            }
            setSyncedAt( props.project.modifiedAt );
            setSaveState( StudioImageEditor.SaveState.SYNCED );
        }
        ensurePageFrame( editor, pageSpec );
        hydrating.current = false;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // toggle edit mode — unlocking (or re-locking) the canvas. Locking flushes any pending work to the server.
    function setEditable( editable : boolean ) : void
    {
        if( props.editing === undefined ) setReadonlyState( !editable );   // uncontrolled → flip local state
        editorRef.current?.updateInstanceState( { isReadonly: !editable } );
        props.onEditModeChange?.( editable );
        if( !editable ) void flushSync();   // "Done" → persist now
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // Cancel out of editing: if there are unsynced changes, prompt (Save / Discard / Keep editing); otherwise
    // just leave edit mode cleanly.
    function onCancelEdit() : void
    {
        if( dirty.current ) setExitPromptOpen( true );
        else setEditable( false );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // exit-prompt: SAVE & CLOSE — persist pending work then leave (setEditable(false) flushes on lock)
    async function onExitSave() : Promise<boolean>
    {
        setExitPromptOpen( false );
        setEditable( false );
        return true;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // exit-prompt: DISCARD — drop the unsynced changes by reloading the last SAVED version (clears `dirty`), then
    // leave. `setEditable(false)`'s flush is then a no-op since nothing is dirty.
    async function onExitDiscard() : Promise<boolean>
    {
        setExitPromptOpen( false );
        await revertToSaved();
        setEditable( false );
        return true;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // a user edit landed → save locally soon (debounced) + schedule a lower-cadence server sync
    function scheduleSave() : void
    {
        if( hydrating.current ) return;   // ignore programmatic changes during restore
        dirty.current = true;
        setSaveState( StudioImageEditor.SaveState.LOCAL );

        // local cache — short debounce so a crash loses almost nothing
        if( localTimer.current !== null ) clearTimeout( localTimer.current );
        localTimer.current = setTimeout( captureLocal, StudioImageEditor.LOCAL_DEBOUNCE_MS );

        // server sync — idle debounce, but force a flush if edits have streamed past the max wait
        const now : number = Date.now();
        if( firstDirtyAt.current === null ) firstDirtyAt.current = now;
        if( syncTimer.current !== null ) clearTimeout( syncTimer.current );
        if( now - firstDirtyAt.current >= StudioImageEditor.SYNC_MAX_MS ) { void syncServer(); return; }
        syncTimer.current = setTimeout( () : void => void syncServer(), StudioImageEditor.SYNC_IDLE_MS );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // capture the current snapshot into the local cache (instant, crash-safe) + remember it for the server sync
    function captureLocal() : void
    {
        const editor : Editor | null = editorRef.current;
        if( editor === null ) return;
        const json : string = JSON.stringify( getSnapshot( editor.store ) );
        appmodel.localStorage.set( storageKey, json );
        latestJson.current = json;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // push the latest snapshot to the server (DDB stamp + S3 canvas). Reads the captured JSON so it works even
    // as the editor tears down (unmount flush).
    async function syncServer() : Promise<void>
    {
        if( syncTimer.current !== null ) { clearTimeout( syncTimer.current ); syncTimer.current = null; }
        if( editorRef.current !== null ) captureLocal();   // make sure the cache/JSON is current
        const json : string | null = latestJson.current;
        if( json === null ) return;

        setSaveState( StudioImageEditor.SaveState.SYNCING );
        const reply : RestfulService.Reply<PutStudioCanvas.Response> = await appmodel.server.fetch( new PutStudioCanvas( props.project.id, { canvas: json } ) );
        if( !reply.ok || !reply.data )
        {
            setSaveState( StudioImageEditor.SaveState.LOCAL );   // still safe on-device; will retry on next edit
            return;
        }
        dirty.current = false;
        firstDirtyAt.current = null;
        setSyncedAt( reply.data.savedAt );
        setSaveState( StudioImageEditor.SaveState.SYNCED );
        // reflect the server's modified stamp in the tree/banner
        const me : string = appmodel.auth.user?.email ?? appmodel.auth.user?.id ?? "unknown";
        props.onProjectChanged?.( { ...props.project, modifiedAt: reply.data.savedAt, modifiedBy: me } );
    }

    /////////////////////////////////////////////////////////////////////////////////////////////
    // flush pending work to the server immediately (on Done / before unmount)
    async function flushSync() : Promise<void>
    {
        if( dirty.current ) await syncServer();
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // reload the last SERVER-saved canvas, discarding local (unsynced) changes
    async function revertToSaved() : Promise<void>
    {
        const editor : Editor | null = editorRef.current;
        if( editor === null ) return;
        const reply : RestfulService.Reply<GetStudioCanvas.Response> = await appmodel.server.fetch( new GetStudioCanvas( props.project.id ) );
        if( !reply.ok ) { setSnack( { message: "Could not load the saved version.", severity: "error" } ); return; }
        if( !reply.data || !reply.data.canvas ) { setSnack( { message: "No saved version yet.", severity: "info" } ); return; }

        hydrating.current = true;
        try { loadSnapshot( editor.store, JSON.parse( reply.data.canvas ) ); } catch { /* ignore */ }
        ensurePageFrame( editor, pageSpec );
        hydrating.current = false;

        // the server copy is now the local truth
        appmodel.localStorage.set( storageKey, reply.data.canvas );
        latestJson.current = reply.data.canvas;
        dirty.current = false;
        firstDirtyAt.current = null;
        setSyncedAt( props.project.modifiedAt );
        setSaveState( StudioImageEditor.SaveState.SYNCED );
        setSnack( { message: "Reverted to last saved.", severity: "success" } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // create the page frame (first time) or resize + rename the existing one to match `spec`. The frame uses
    // the deterministic `pageFrameId`, so re-setup always hits the SAME frame. Its canvas size IS its output
    // pixel size, so exporting it at pixelRatio 1 yields exact pixels.
    function ensurePageFrame( editor : Editor, spec : StudioProject.PageSpec ) : void
    {
        const pixels : { width : number; height : number } = StudioImageEditor.pagePixels( spec );
        // name is blank so the frame shows no top-left label (the size lives in the toolbar + out of exports)
        const frameProps : { w : number; h : number; name : string } = { w: pixels.width, h: pixels.height, name: "" };
        if( editor.getShape( pageFrameId ) !== undefined )
            editor.updateShape( { id: pageFrameId, type: "frame", props: frameProps } );
        else
            editor.createShape( { id: pageFrameId, type: "frame", x: 0, y: 0, props: frameProps } );
        editor.zoomToFit();
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // apply a new page definition — resize the frame locally, then PERSIST the page to the project (so the doc
    // size follows the layout change on the server too)
    async function applyPage( spec : StudioProject.PageSpec ) : Promise<void>
    {
        setSetupOpen( false );
        setPageSpec( spec );
        const editor : Editor | null = editorRef.current;
        if( editor !== null ) ensurePageFrame( editor, spec );
        const reply : RestfulService.Reply<PatchStudioProject.Response> = await appmodel.server.fetch( new PatchStudioProject( props.project.id, { page: spec } ) );
        if( reply.ok && reply.data ) props.onProjectChanged?.( reply.data.project );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // render the PAGE (the frame) to a PNG/JPEG and save it to the media library. FIRST save creates a new
    // IMAGE asset (remembered on the project via libraryAssetId); LATER saves REPLACE that asset's bytes in
    // place (same guid + S3 key). pixelRatio 1 yields the page's exact pixels.
    async function saveToLibrary() : Promise<void>
    {
        const editor : Editor | null = editorRef.current;
        if( editor === null ) return;
        const target : Array<TLShapeId> = editor.getShape( pageFrameId ) !== undefined
            ? [ pageFrameId ]
            : [ ...editor.getCurrentPageShapeIds() ];
        if( target.length === 0 ) { setSnack( { message: "Nothing to save yet.", severity: "info" } ); return; }

        setSaving( true );

        const mime : string = saveFormat === "jpeg" ? "image/jpeg" : "image/png";
        const image : { blob : Blob } = await editor.toImage( target, { format: saveFormat, background: true, pixelRatio: 1 } );
        const base : string = props.project.name.trim() === "" ? "Studio composite" : props.project.name.trim();

        // presign an upload slot: REPLACE the existing library asset if we have one, else CREATE a new asset
        // (a replace of a since-deleted asset returns not-ok → we fall through to a fresh create)
        const existingGuid : string | undefined = props.project.libraryAssetId;
        const slot : StudioImageEditor.UploadSlot | null = existingGuid
            ? await StudioImageEditor.beginReplace( appmodel, existingGuid, image.blob.size, mime ) ?? await StudioImageEditor.beginCreate( appmodel, base, image.blob.size, mime )
            : await StudioImageEditor.beginCreate( appmodel, base, image.blob.size, mime );
        if( slot === null ) { setSaving( false ); setSnack( { message: "Could not start the save.", severity: "error" } ); return; }

        // PUT the bytes straight to S3, then complete (kicks off scan → process / regenerate variants)
        const put : Response = await fetch( slot.url, { method: slot.method, body: image.blob, headers: { "Content-Type": mime } } );
        if( !put.ok ) { setSaving( false ); setSnack( { message: "Upload failed.", severity: "error" } ); return; }
        const done : RestfulService.Reply<PostUploadComplete.Response> = await appmodel.server.fetch( new PostUploadComplete( slot.guid ) );
        if( !done.ok ) { setSaving( false ); setSnack( { message: "Save did not complete.", severity: "error" } ); return; }

        // name it + carry the project's tags and campaign association (best-effort)
        const campaignIds : Array<string> = props.project.campaignId && props.project.campaignId !== "" ? [ props.project.campaignId ] : [];
        const tagged : RestfulService.Reply<PatchAsset.Response> = await appmodel.server.fetch( new PatchAsset( slot.guid, { name: base, tags: props.project.tags ?? [], campaignIds } ) );
        if( !tagged.ok ) { /* asset saved; metadata is best-effort */ }

        // first-time save → remember the asset guid on the project (so the NEXT save updates this same asset)
        if( slot.guid !== existingGuid )
        {
            const linked : RestfulService.Reply<PatchStudioProject.Response> = await appmodel.server.fetch( new PatchStudioProject( props.project.id, { libraryAssetId: slot.guid } ) );
            if( linked.ok && linked.data ) props.onProjectChanged?.( linked.data.project );
        }

        setSaving( false );
        setSnack( { message: existingGuid && slot.guid === existingGuid ? "Updated in library." : "Saved to library.", severity: "success" } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // place an image (by delivery URL) onto the canvas near the viewport center — registers a tldraw asset then
    // creates an image shape bound to it, scaling large images down to a sensible placement size
    async function insertImage( url : string, name : string ) : Promise<void>
    {
        const editor : Editor | null = editorRef.current;
        if( editor === null ) return;

        const size : { width : number; height : number } = await StudioImageEditor.measureImage( url );
        const assetId : TLAssetId = AssetRecordType.createId();
        const asset : TLAsset = AssetRecordType.create( {
            id: assetId, type: "image",
            props: { name, src: url, w: size.width, h: size.height, mimeType: null, isAnimated: false },
        } );
        editor.createAssets( [ asset ] );

        // parent the image INTO the page frame (when it exists) so it's a sibling of the text/shapes there —
        // otherwise a page-root image renders above the whole frame subtree and text can never be raised over it.
        // Coordinates are relative to the parent, so center it within the page (frame-local space).
        const inFrame : boolean = editor.getShape( pageFrameId ) !== undefined;
        const page : { width : number; height : number } = StudioImageEditor.pagePixels( pageSpec );
        const center : { x : number; y : number } = editor.getViewportPageBounds().center;
        const originX : number = inFrame ? page.width / 2 - size.width / 2 : center.x - size.width / 2;
        const originY : number = inFrame ? page.height / 2 - size.height / 2 : center.y - size.height / 2;
        const shapeId : ReturnType<typeof createShapeId> = createShapeId();
        editor.createShape( {
            id: shapeId, type: "image", parentId: inFrame ? pageFrameId : undefined,
            x: originX, y: originY,
            props: { assetId, w: size.width, h: size.height },
        } );
        editor.select( shapeId );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // library picks confirmed → drop each chosen image onto the canvas
    function onLibraryPick( picks : Array<StudioLibraryPickerDialog.Pick> ) : void
    {
        setLibraryOpen( false );
        picks.forEach( ( pick : StudioLibraryPickerDialog.Pick ) : void => void insertImage( pick.url, pick.name ) );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // an imported file finished uploading → associate it with this project's campaign, resolve a delivery URL,
    // and place it on the canvas (so an import both lands in the library AND appears in the composition)
    async function onUploaded( assets : Array<Media.Asset> ) : Promise<void>
    {
        setProvidersOpen( false );
        for( const asset of assets )
        {
            // tie the new library asset to this campaign (best-effort — a miss just leaves it unassigned)
            if( props.project.campaignId && props.project.campaignId !== "" )
            {
                const tagged : RestfulService.Reply<PatchAsset.Response> = await appmodel.server.fetch( new PatchAsset( asset.guid, { campaignIds: [ props.project.campaignId ] } ) );
                if( !tagged.ok ) { /* leave unassigned; still usable */ }
            }
            // resolve a delivery URL (retrying while a just-imported asset finishes scanning) and drop it in
            const url : string | null = await resolveUrl( asset.guid );
            if( url !== null ) await insertImage( url, asset.name );
        }
    }

    // resolve an asset's delivery URL, retrying while it's briefly non-servable (SCANNING right after import)
    async function resolveUrl( guid : string ) : Promise<string | null>
    {
        for( let attempt : number = 0; attempt < StudioImageEditor.URL_RETRIES; attempt++ )
        {
            const url : RestfulService.Reply<GetMediaUrl.Response> = await appmodel.server.fetch( new GetMediaUrl( guid ) );
            if( url.ok && url.data ) return url.data.url;
            await new Promise<void>( ( resolve : () => void ) : void => { setTimeout( resolve, StudioImageEditor.URL_RETRY_MS ); } );
        }
        return null;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // the footer save-state chip — local-only vs synced-to-server (with the last sync time)
    function saveChip() : JSX.Element
    {
        if( saveState === StudioImageEditor.SaveState.SYNCING )
            return <Chip size="small" variant="outlined" icon={ <CloudSyncOutlinedIcon /> } label={"Syncing…"} />;
        if( saveState === StudioImageEditor.SaveState.LOCAL )
            return <Chip size="small" variant="outlined" color="warning" icon={ <CloudQueueOutlinedIcon /> } label={"Saved locally"} />;
        if( saveState === StudioImageEditor.SaveState.SYNCED )
            return <Chip size="small" variant="outlined" color="success" icon={ <CloudDoneOutlinedIcon /> } label={ syncedAt ? `Synced ${ appmodel.ui.locale.time( new Date( syncedAt ), LocaleService.Format.SHORT ) }` : "Synced" } />;
        return <Chip size="small" variant="outlined" icon={ <CloudDoneOutlinedIcon /> } label={"Autosave on"} />;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // format an ISO stamp as a compact date + time for the footer (em-dash when absent)
    function footerWhen( iso? : string ) : string
    {
        if( !iso ) return "—";
        return appmodel.ui.locale.dateTime( new Date( iso ), LocaleService.Format.SHORT ) || "—";
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    return  <Box sx={{ height: "100%", minHeight: 0, display: "flex", flexDirection: "column" }}>

                {/* actions bar — editing tools only (hidden in read-only; Edit lives in the studio banner) */}
                { !readonly &&
                    <Stack direction="row" spacing={ 1 } sx={{ alignItems: "center", px: 1.5, py: 0.75, borderBottom: 1, borderColor: "divider", flexShrink: 0 }}>
                        <Button variant="contained" color="primary" startIcon={ <ImageOutlinedIcon /> } onClick={ () : void => setLibraryOpen( true ) }>{"Add from Library"}</Button>
                        <Button size="small" startIcon={ <TravelExploreOutlinedIcon /> } onClick={ () : void => setProvidersOpen( true ) }>{"Add from Providers"}</Button>
                        <Pusher />
                        {/* page size + density — defines the page frame content clips to and saves at */}
                        <Button size="small" startIcon={ <CropOutlinedIcon /> } onClick={ () : void => setSetupOpen( true ) }>{ StudioImageEditor.pageLabel( pageSpec ) }</Button>
                        {/* the raster format the composite is saved to the library as */}
                        <SelectInput id="save-format" label={"Format"} dense value={ saveFormat }
                                     choices={ StudioImageEditor.SAVE_FORMATS.map( ( format : { key : "png" | "jpeg"; label : string; mime : string } ) : SelectInput.Choice => ( { value: format.key, label: format.label } ) ) }
                                     onChange={ ( value : string ) : void => setSaveFormat( value as "png" | "jpeg" ) } sx={{ width: 96 }} />
                        <Button size="small" variant="outlined" disabled={ saving }
                                startIcon={ saving ? <CircularProgress size={ 14 } color="inherit" /> : <SaveOutlinedIcon /> }
                                onClick={ () : void => void saveToLibrary() }>
                            { saving ? "Exporting…" : "Export" }
                        </Button>
                        <Button size="small" color="inherit" startIcon={ <RestoreOutlinedIcon /> } onClick={ () : void => void revertToSaved() }>{"Revert"}</Button>
                        <Button size="small" color="inherit" startIcon={ <CloseOutlinedIcon /> } onClick={ () : void => onCancelEdit() }>{"Cancel"}</Button>
                        <Button size="small" variant="contained" color="primary" startIcon={ <LockOutlinedIcon /> } onClick={ () : void => setEditable( false ) }>{"Save"}</Button>
                    </Stack> }

                {/* the canvas — tldraw fills this relatively-positioned box; color scheme follows the MUI theme.
                    the frame's name label (top-left) is hidden — the page size shows in the toolbar instead. */}
                <Box sx={{ position: "relative", flexGrow: 1, minHeight: 0, "& .tl-frame-heading": { display: "none" } }}>
                    <StudioBrandContext.Provider value={{ campaignPalette, campaignFonts }}>
                        <Tldraw onMount={ onMount } colorScheme={ theme.palette.mode === "dark" ? "dark" : "light" } components={ STUDIO_EDITOR_COMPONENTS } />
                    </StudioBrandContext.Provider>
                </Box>

                {/* footer — pinned to the bottom: created/modified stamps on the left, the sync chip on the right */}
                <Stack direction="row" spacing={ 2 } sx={{ alignItems: "center", px: 1.5, py: 0.5, borderTop: 1, borderColor: "divider", flexShrink: 0, bgcolor: "background.paper" }}>
                    <Typography variant="caption" sx={{ color: "text.secondary" }}>{ `Created ${ footerWhen( props.project.createdAt ) }` }</Typography>
                    <Typography variant="caption" sx={{ color: "text.secondary" }}>{ `Modified ${ footerWhen( props.project.modifiedAt ) }` }</Typography>
                    <Pusher/>
                    { saveChip() }
                </Stack>

                { libraryOpen &&
                    <StudioLibraryPickerDialog campaignId={ props.project.campaignId } onPick={ onLibraryPick } onClose={ () : void => setLibraryOpen( false ) } /> }

                { providersOpen &&
                    <StudioProvidersDialog onImported={ onUploaded } onClose={ () : void => setProvidersOpen( false ) } /> }

                { setupOpen &&
                    <StudioPageSetupDialog spec={ pageSpec } onApply={ applyPage } onClose={ () : void => setSetupOpen( false ) } /> }

                { exitPromptOpen &&
                    <StudioExitPrompt onSave={ onExitSave } onDiscard={ onExitDiscard } onClose={ () : void => setExitPromptOpen( false ) } /> }

                { snack && <SnackAlert message={ snack.message } severity={ snack.severity } onClose={ () : void => setSnack( null ) } /> }
            </Box>;
}

export namespace StudioImageEditor
{
    export const STORAGE_PREFIX : string = "studio.canvas.";   // per-project local canvas cache key prefix
    export const LOCAL_DEBOUNCE_MS : number = 700;             // quiet period before writing the local cache
    export const SYNC_IDLE_MS : number = 8000;                 // idle period before a server sync
    export const SYNC_MAX_MS : number = 30000;                 // force a server sync at least this often during edits
    export const URL_RETRIES : number = 8;                     // delivery-URL attempts (asset finishes scanning)
    export const URL_RETRY_MS : number = 900;                  // delay between delivery-URL attempts
    export const MAX_PLACE_SIZE : number = 640;                // scale a placed image down to this max dimension

    /** Print-density presets (dots per inch). 72 = web/screen, 300 = standard print, 600 = fine print. */
    export const DPI_CHOICES : Array<number> = [ 72, 150, 300, 600 ];

    /** A ready-made page size (fills the Page Setup form when chosen). `dpi` optionally pins a density too. */
    export interface PagePreset { key : string; label : string; unit : StudioProject.PageUnit; width : number; height : number; dpi? : number; }

    /** Common page presets — print paper (inches) and social/web canvases (pixels); "Custom" lets the user type. */
    export const PAGE_PRESETS : Array<PagePreset> =
    [
        { key: "custom",       label: "Custom",                    unit: StudioProject.PageUnit.INCHES, width: 8.5,  height: 11 },
        { key: "letter",       label: "Letter — 8.5 × 11 in",      unit: StudioProject.PageUnit.INCHES, width: 8.5,  height: 11 },
        { key: "legal",        label: "Legal — 8.5 × 14 in",       unit: StudioProject.PageUnit.INCHES, width: 8.5,  height: 14 },
        { key: "tabloid",      label: "Tabloid — 11 × 17 in",      unit: StudioProject.PageUnit.INCHES, width: 11,   height: 17 },
        { key: "postcard_9x6", label: "Postcard — 9 × 6 in @300 dpi", unit: StudioProject.PageUnit.INCHES, width: 9, height: 6, dpi: 300 },
        { key: "a4",           label: "A4 — 8.27 × 11.69 in",      unit: StudioProject.PageUnit.INCHES, width: 8.27, height: 11.69 },
        { key: "a3",           label: "A3 — 11.69 × 16.54 in",     unit: StudioProject.PageUnit.INCHES, width: 11.69, height: 16.54 },
        { key: "ig_post",      label: "Instagram Post — 1080 × 1080 px",  unit: StudioProject.PageUnit.PIXELS, width: 1080, height: 1080 },
        { key: "ig_story",     label: "Instagram Story — 1080 × 1920 px", unit: StudioProject.PageUnit.PIXELS, width: 1080, height: 1920 },
        { key: "fb_cover",     label: "Facebook Cover — 1200 × 630 px",   unit: StudioProject.PageUnit.PIXELS, width: 1200, height: 630 },
    ];

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** The page's output pixel dimensions — inches × DPI, or the pixel dimensions verbatim. */
    export function pagePixels( spec : StudioProject.PageSpec ) : { width : number; height : number }
    {
        if( spec.unit === StudioProject.PageUnit.PIXELS ) return { width: Math.round( spec.width ), height: Math.round( spec.height ) };
        return { width: Math.round( spec.width * spec.dpi ), height: Math.round( spec.height * spec.dpi ) };
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** A short human label for the page (e.g. "8.5 × 11 in @300" or "1080 × 1080 px"). */
    export function pageLabel( spec : StudioProject.PageSpec ) : string
    {
        if( spec.unit === StudioProject.PageUnit.PIXELS ) return `${ spec.width } × ${ spec.height } px`;
        return `${ spec.width } × ${ spec.height } in @${ spec.dpi }`;
    }

    /** The raster formats a composite can be saved as. */
    export const SAVE_FORMATS : Array<{ key : "png" | "jpeg"; label : string; mime : string }> =
    [
        { key: "png",  label: "PNG",  mime: "image/png" },
        { key: "jpeg", label: "JPEG", mime: "image/jpeg" },
    ];

    /** A presigned upload target (create or replace) — enough to PUT the bytes and then complete the save. */
    export interface UploadSlot { guid : string; url : string; method : string; }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** Begin a NEW library asset upload (returns the slot, or null on failure). */
    export async function beginCreate( appmodel : AppModel, name : string, size : number, mime : string ) : Promise<UploadSlot | null>
    {
        const extension : string = mime === "image/jpeg" ? "jpg" : "png";
        const begin : RestfulService.Reply<PostUpload.Response> = await appmodel.server.fetch( new PostUpload( { filename: `${ name }.${ extension }`, mime, size, scope: Media.Scope.ACCOUNT, kind: Media.Kind.IMAGE } ) );
        if( !begin.ok || !begin.data ) return null;
        return { guid: begin.data.asset.guid, url: begin.data.upload.url, method: begin.data.upload.method };
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** Begin a REPLACE of an existing asset's bytes in place (returns the slot, or null if not replaceable). */
    export async function beginReplace( appmodel : AppModel, guid : string, size : number, mime : string ) : Promise<UploadSlot | null>
    {
        const begin : RestfulService.Reply<PostAssetReplace.Response> = await appmodel.server.fetch( new PostAssetReplace( guid, { size, mime } ) );
        if( !begin.ok || !begin.data ) return null;
        return { guid: begin.data.asset.guid, url: begin.data.upload.url, method: begin.data.upload.method };
    }

    /** The autosave lifecycle shown in the footer (two-tier: local cache vs server sync). */
    export enum SaveState
    {
        IDLE    = "idle",       // nothing changed yet this session
        LOCAL   = "local",      // saved to the local cache; a server sync is pending
        SYNCING = "syncing",    // pushing the snapshot to the server
        SYNCED  = "synced",     // server holds the latest
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** Measure an image URL's natural size, scaled to {@link MAX_PLACE_SIZE}; falls back to a square on error. */
    export async function measureImage( url : string ) : Promise<{ width : number; height : number }>
    {
        return new Promise( ( resolve : ( size : { width : number; height : number } ) => void ) : void =>
        {
            const image : HTMLImageElement = new Image();
            image.onload = () : void =>
            {
                const naturalWidth : number = image.naturalWidth || MAX_PLACE_SIZE;
                const naturalHeight : number = image.naturalHeight || MAX_PLACE_SIZE;
                const scale : number = Math.min( 1, MAX_PLACE_SIZE / Math.max( naturalWidth, naturalHeight ) );
                resolve( { width: Math.round( naturalWidth * scale ), height: Math.round( naturalHeight * scale ) } );
            };
            image.onerror = () : void => resolve( { width: MAX_PLACE_SIZE, height: MAX_PLACE_SIZE } );
            image.src = url;
        } );
    }

    export interface Props
    {
        project           : StudioProject.Entity;   // the IMAGE project being edited
        editing?          : boolean;                 // CONTROLLED edit mode (parent-owned; Edit lives in the banner)
        onProjectChanged? : ( project : StudioProject.Entity ) => void;   // the server updated the project (sync / page / library) → refresh the tree
        onEditModeChange? : ( editing : boolean ) => void;   // report lock/unlock so the parent can gate the properties gear
    }
}

export default StudioImageEditor;
// eof
