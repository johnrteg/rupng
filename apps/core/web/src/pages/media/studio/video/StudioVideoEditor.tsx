import AppModel from "@model/AppModel";
//
import React from 'react';
import { JSX } from "react";

import { Box, Button, Stack, Typography } from "@mui/material";
import MovieCreationOutlinedIcon from '@mui/icons-material/MovieCreationOutlined';
import LockOutlinedIcon       from '@mui/icons-material/LockOutlined';
import CloseOutlinedIcon      from '@mui/icons-material/CloseOutlined';
import PlayCircleFilledOutlinedIcon from '@mui/icons-material/PlayCircleFilledOutlined';
import PauseOutlinedIcon      from '@mui/icons-material/PauseOutlined';
import SkipPreviousOutlinedIcon from '@mui/icons-material/SkipPreviousOutlined';
import SkipNextOutlinedIcon   from '@mui/icons-material/SkipNextOutlined';
import AudiotrackOutlinedIcon from '@mui/icons-material/AudiotrackOutlined';
import CloudDoneOutlinedIcon  from '@mui/icons-material/CloudDoneOutlined';
import CloudSyncOutlinedIcon  from '@mui/icons-material/CloudSyncOutlined';
import CloudQueueOutlinedIcon from '@mui/icons-material/CloudQueueOutlined';

import { Player, PlayerRef } from '@remotion/player';

import { Media, StudioProject, PatchAsset, GetMediaUrl, GetStudioCanvas, PutStudioCanvas, PostStudioRender, GetAsset, PostAssetTranscribe } from '@repo/api';
import { RestfulService } from '@repo/endpoint';

import LocaleService        from '@model/service/LocaleService';
import SnackAlert           from '@widgets/core/SnackAlert';
import ChipStatus           from '@widgets/core/ChipStatus';
import ButtonIcon           from '@widgets/core/ButtonIcon';
import UserChip             from '@widgets/app/UserChip';
import Colors               from '@utils/Colors';
import Pusher               from '@widgets/core/Pusher';
import MediaUploadDialog    from '@widgets/media/MediaUploadDialog';
import StudioLibraryPickerDialog from '@pages/media/studio/StudioLibraryPickerDialog';
import StudioProvidersDialog      from '@pages/media/studio/StudioProvidersDialog';
import { StudioVideoComposition } from '@repo/studio-composition';
import StudioTimeline            from '@pages/media/studio/video/StudioTimeline';
import StudioClipInspector       from '@pages/media/studio/video/StudioClipInspector';

//
// StudioVideoEditor — the video-composition surface for a VIDEO Studio project, laid out as a real editor:
// an ACTION ROW (add media/text, edit toggle, export), a centered PLAYER with a PLAYBACK bar, a right-hand
// INSPECTOR (selected-clip / composition properties), and a bottom TIMELINE (multi-track, time-overlapping
// clips with drag/resize + playhead + zoom). The doc is a track/clip timeline persisted as the project canvas
// JSON; it keeps the image editor's shell — read-only by default + Edit toggle, and two-tier autosave
// (instant localStorage + low-cadence server sync). A master FORMAT + chosen DESTINATIONS drive the render.
//
export function StudioVideoEditor( props : StudioVideoEditor.Props ) : JSX.Element
{
    const appmodel : AppModel = AppModel.instance();

    const [doc,setDoc]             = React.useState< StudioProject.VideoDoc >( () => StudioProject.migrateToTimeline( { ...StudioVideoComposition.DEFAULT_DOC } ) );
    const [saveState,setSaveState] = React.useState< StudioVideoEditor.SaveState >( StudioVideoEditor.SaveState.IDLE );
    const [syncedAt,setSyncedAt]   = React.useState< string | null >( null );
    const [readonlyState,setReadonlyState] = React.useState< boolean >( true );
    const [libraryOpen,setLibraryOpen] = React.useState< boolean >( false );
    const [watermarkPickOpen,setWatermarkPickOpen] = React.useState< boolean >( false );
    const [uploadOpen,setUploadOpen]   = React.useState< boolean >( false );
    const [providersOpen,setProvidersOpen] = React.useState< boolean >( false );
    const [snack,setSnack]         = React.useState< { message : string; severity : SnackAlert.Severity } | null >( null );
    // multi-selection is the source of truth (array); the PRIMARY (last) drives the inspector + single-clip ops
    // (drag / duplicate / copy). setSelectedClipId is a shim so the existing single-select call sites are unchanged.
    const [selection,setSelection] = React.useState< Array<string> >( [] );
    const selectedClipId : string | null = selection.length > 0 ? selection[ selection.length - 1 ] : null;
    function setSelectedClipId( id : string | null ) : void { setSelection( id === null ? [] : [ id ] ); }
    // toggle a clip in/out of the multi-selection (Shift/⌘-click)
    function toggleSelect( id : string ) : void
    { setSelection( ( current : Array<string> ) : Array<string> => current.includes( id ) ? current.filter( ( entry : string ) : boolean => entry !== id ) : [ ...current, id ] ); }
    const [historyState,setHistoryState] = React.useState< { canUndo : boolean; canRedo : boolean } >( { canUndo: false, canRedo: false } );
    // the undo/redo stacks + the timestamp of the last committed edit (for burst coalescing) — a ref so a drag's
    // rapid mutations don't each trigger a re-render; only the derived canUndo/canRedo lives in state
    const historyRef = React.useRef< { past : Array<StudioProject.VideoDoc>; future : Array<StudioProject.VideoDoc>; lastAt : number } >( { past: [], future: [], lastAt: 0 } );
    const [currentSec,setCurrentSec] = React.useState< number >( 0 );
    const [pxPerSec,setPxPerSec]     = React.useState< number >( 60 );
    const [playing,setPlaying]       = React.useState< boolean >( false );

    const playerRef    = React.useRef< PlayerRef | null >( null );
    const docRef       = React.useRef< StudioProject.VideoDoc >( doc );   // latest doc for the sync closures
    const localTimer   = React.useRef< ReturnType<typeof setTimeout> | null >( null );
    const syncTimer    = React.useRef< ReturnType<typeof setTimeout> | null >( null );
    const firstDirtyAt = React.useRef< number | null >( null );
    const dirty        = React.useRef< boolean >( false );
    const latestJson   = React.useRef< string | null >( null );
    const hydrating    = React.useRef< boolean >( true );
    const clipboard    = React.useRef< StudioProject.TimelineClip | null >( null );   // copy/paste buffer (one clip)
    const currentSecRef = React.useRef< number >( 0 );   // latest playhead for paste-at-playhead (avoids a stale closure)
    currentSecRef.current = currentSec;

    // edit mode is CONTROLLED by the parent when `editing` is passed (the Edit button lives in the studio
    // banner, on the title line); otherwise it falls back to the local read-only state
    const readonly : boolean = props.editing === undefined ? readonlyState : !props.editing;

    const storageKey : string = `${ StudioVideoEditor.STORAGE_PREFIX }${ props.project.id }`;
    const clips : Array<StudioProject.TimelineClip> = doc.clips ?? [];
    const hasClips : boolean = clips.length > 0;
    const selectedClip : StudioProject.TimelineClip | null = clips.find( ( clip : StudioProject.TimelineClip ) : boolean => clip.id === selectedClipId ) ?? null;
    const totalSec : number = StudioProject.timelineDurationSec( doc );
    // a clip can be split only when the playhead sits strictly inside the selected clip
    const canSplit : boolean = selectedClip !== null && currentSec > selectedClip.startSec + 0.05 && currentSec < selectedClip.startSec + selectedClip.durationSec - 0.05;

    // stable Player props — the playhead updates state ~every frame, so WITHOUT memoizing these the Player would
    // get a fresh inputProps object each render, re-evaluating the composition and making <Audio> stutter
    const playerInputProps = React.useMemo( () : { doc : StudioProject.VideoDoc } => ( { doc } ), [ doc ] );
    const playerDuration : number = React.useMemo( () : number => StudioVideoComposition.totalFrames( doc ), [ doc ] );

    ////////////////////////////////////////////////////////////////////////////////////////////
    React.useEffect( () : ( () => void ) =>
    {
        void hydrate();
        return () : void =>
        {
            if( localTimer.current !== null ) clearTimeout( localTimer.current );
            if( syncTimer.current !== null ) clearTimeout( syncTimer.current );
            if( dirty.current ) void syncServer();
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [] );

    //////////////////////////////////////////////////////////////////////
    // bind Player events (frame → playhead, play/pause state) once a player is mounted
    React.useEffect( () : ( () => void ) =>
    {
        const player : PlayerRef | null = playerRef.current;
        if( player === null ) return () : void => { /* nothing mounted */ };
        const onFrame = ( event : { detail : { frame : number } } ) : void => setCurrentSec( event.detail.frame / docRef.current.fps );
        const onPlay = () : void => setPlaying( true );
        const onPause = () : void => setPlaying( false );
        player.addEventListener( "frameupdate", onFrame );
        player.addEventListener( "play", onPlay );
        player.addEventListener( "pause", onPause );
        return () : void =>
        {
            player.removeEventListener( "frameupdate", onFrame );
            player.removeEventListener( "play", onPlay );
            player.removeEventListener( "pause", onPause );
        };
    }, [ hasClips ] );

    //////////////////////////////////////////////////////////////////////
    // keyboard shortcuts while editing: ⌘/Ctrl+Z undo, ⇧+ redo (or ⌘/Ctrl+Y), ⌘/Ctrl+D duplicate,
    // Delete/Backspace remove the selected clip, Space play/pause. Ignored while typing in a field.
    React.useEffect( () : ( () => void ) =>
    {
        if( readonly ) return () : void => { /* view-only: no editing shortcuts */ };
        function onKeyDown( event : KeyboardEvent ) : void
        {
            // never hijack keys while the user is typing in an input / textarea / contenteditable
            const target : HTMLElement | null = event.target as HTMLElement | null;
            const tag : string = target?.tagName ?? "";
            if( tag === "INPUT" || tag === "TEXTAREA" || target?.isContentEditable === true ) return;
            const meta : boolean = event.metaKey || event.ctrlKey;
            const key : string = event.key.toLowerCase();
            if( meta && key === "z" ) { event.preventDefault(); if( event.shiftKey ) redo(); else undo(); return; }
            if( meta && key === "y" ) { event.preventDefault(); redo(); return; }
            if( meta && key === "d" ) { event.preventDefault(); duplicateSelected(); return; }
            if( meta && key === "c" ) { event.preventDefault(); copySelected(); return; }
            if( meta && key === "v" ) { event.preventDefault(); pasteClip(); return; }
            if( ( event.key === "Delete" || event.key === "Backspace" ) && selectedClipId !== null ) { event.preventDefault(); if( event.shiftKey ) rippleDeleteSelected(); else removeSelected(); return; }
            if( event.key === " " ) { event.preventDefault(); togglePlay(); return; }
        }
        window.addEventListener( "keydown", onKeyDown );
        return () : void => window.removeEventListener( "keydown", onKeyDown );
    }, [ readonly, selectedClipId ] );

    //////////////////////////////////////////////////////////////////////
    // restore the doc: prefer the local cache (crash-safe), else the server copy, else a blank doc
    async function hydrate() : Promise<void>
    {
        hydrating.current = true;
        const cached : string = appmodel.localStorage.get( storageKey ) ?? "";
        if( cached !== "" ) { applyJson( cached ); }
        else
        {
            const reply : RestfulService.Reply<GetStudioCanvas.Response> = await appmodel.server.fetch( new GetStudioCanvas( props.project.id ) );
            if( reply.ok && reply.data && reply.data.canvas ) applyJson( reply.data.canvas );
            setSyncedAt( props.project.modifiedAt );
            setSaveState( StudioVideoEditor.SaveState.SYNCED );
        }
        hydrating.current = false;
    }

    //////////////////////////////////////////////////////////////////////
    // parse a canvas JSON string into the doc — merged over defaults + migrated to the timeline model
    function applyJson( json : string ) : void
    {
        try
        {
            const merged : StudioProject.VideoDoc = { ...StudioVideoComposition.DEFAULT_DOC, ...( JSON.parse( json ) as Partial<StudioProject.VideoDoc> ) };
            const parsed : StudioProject.VideoDoc = StudioProject.migrateToTimeline( merged );
            setDoc( parsed );
            docRef.current = parsed;
            latestJson.current = json;
        }
        catch { /* keep the default doc */ }
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // apply a doc to state/ref + autosave, WITHOUT touching the undo history (used by undo/redo themselves)
    function applyDoc( next : StudioProject.VideoDoc ) : void
    {
        setDoc( next );
        docRef.current = next;
        scheduleSave();
    }

    // apply a doc change + record it for undo (the single mutation path). Rapid bursts (e.g. a drag firing on
    // every pointer-move) COALESCE into one history entry: the pre-change state is snapshotted only when the
    // previous commit was more than HISTORY_COALESCE_MS ago, so one undo reverts the whole gesture.
    function mutate( next : StudioProject.VideoDoc ) : void
    {
        const now : number = Date.now();
        if( now - historyRef.current.lastAt > StudioVideoEditor.HISTORY_COALESCE_MS )
        {
            historyRef.current.past.push( docRef.current );
            if( historyRef.current.past.length > StudioVideoEditor.HISTORY_LIMIT ) historyRef.current.past.shift();
            historyRef.current.future = [];
            setHistoryState( { canUndo: true, canRedo: false } );
        }
        historyRef.current.lastAt = now;
        applyDoc( next );
    }

    // undo/redo — swap the current doc with the top of the past/future stack (history-neutral apply)
    function undo() : void
    {
        const previous : StudioProject.VideoDoc | undefined = historyRef.current.past.pop();
        if( previous === undefined ) return;
        historyRef.current.future.push( docRef.current );
        historyRef.current.lastAt = 0;   // the next edit starts a fresh history entry
        setHistoryState( { canUndo: historyRef.current.past.length > 0, canRedo: true } );
        applyDoc( previous );
    }
    function redo() : void
    {
        const next : StudioProject.VideoDoc | undefined = historyRef.current.future.pop();
        if( next === undefined ) return;
        historyRef.current.past.push( docRef.current );
        historyRef.current.lastAt = 0;
        setHistoryState( { canUndo: true, canRedo: historyRef.current.future.length > 0 } );
        applyDoc( next );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // a user edit landed → save locally soon (debounced) + schedule a lower-cadence server sync
    function scheduleSave() : void
    {
        if( hydrating.current ) return;
        dirty.current = true;
        setSaveState( StudioVideoEditor.SaveState.LOCAL );

        if( localTimer.current !== null ) clearTimeout( localTimer.current );
        localTimer.current = setTimeout( captureLocal, StudioVideoEditor.LOCAL_DEBOUNCE_MS );

        const now : number = Date.now();
        if( firstDirtyAt.current === null ) firstDirtyAt.current = now;
        if( syncTimer.current !== null ) clearTimeout( syncTimer.current );
        if( now - firstDirtyAt.current >= StudioVideoEditor.SYNC_MAX_MS ) { void syncServer(); return; }
        syncTimer.current = setTimeout( () : void => void syncServer(), StudioVideoEditor.SYNC_IDLE_MS );
    }

    //////////////////////////////////////////////////////////////////////
    // write the current doc to the local cache (instant, crash-safe) + remember it for the server sync
    function captureLocal() : void
    {
        const json : string = JSON.stringify( docRef.current );
        appmodel.localStorage.set( storageKey, json );
        latestJson.current = json;
    }

    //////////////////////////////////////////////////////////////////////
    // push the latest doc to the server (S3 canvas + DDB stamp)
    async function syncServer() : Promise<void>
    {
        if( syncTimer.current !== null ) { clearTimeout( syncTimer.current ); syncTimer.current = null; }
        captureLocal();
        const json : string | null = latestJson.current;
        if( json === null ) return;

        setSaveState( StudioVideoEditor.SaveState.SYNCING );
        const reply : RestfulService.Reply<PutStudioCanvas.Response> = await appmodel.server.fetch( new PutStudioCanvas( props.project.id, { canvas: json } ) );
        if( !reply.ok || !reply.data ) { setSaveState( StudioVideoEditor.SaveState.LOCAL ); return; }
        dirty.current = false;
        firstDirtyAt.current = null;
        setSyncedAt( reply.data.savedAt );
        setSaveState( StudioVideoEditor.SaveState.SYNCED );
        const me : string = appmodel.auth.user?.email ?? appmodel.auth.user?.id ?? "unknown";
        props.onProjectChanged?.( { ...props.project, modifiedAt: reply.data.savedAt, modifiedBy: me } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // toggle edit mode; locking flushes pending work to the server. When CONTROLLED (parent passes `editing`),
    // the parent owns the flag — we just report the change; otherwise flip the local state.
    function setEditable( editable : boolean ) : void
    {
        if( props.editing === undefined ) setReadonlyState( !editable );
        props.onEditModeChange?.( editable );
        if( !editable && dirty.current ) void syncServer();
    }

    //////////////////////////////////////////////////////////////////////
    // reload the last server-saved doc, discarding local (unsynced) changes
    async function revertToSaved() : Promise<void>
    {
        const reply : RestfulService.Reply<GetStudioCanvas.Response> = await appmodel.server.fetch( new GetStudioCanvas( props.project.id ) );
        if( !reply.ok ) { setSnack( { message: "Could not load the saved version.", severity: "error" } ); return; }
        if( !reply.data || !reply.data.canvas ) { setSnack( { message: "No saved version yet.", severity: "info" } ); return; }
        hydrating.current = true;
        applyJson( reply.data.canvas );
        appmodel.localStorage.set( storageKey, reply.data.canvas );
        dirty.current = false;
        firstDirtyAt.current = null;
        setSyncedAt( props.project.modifiedAt );
        setSaveState( StudioVideoEditor.SaveState.SYNCED );
        hydrating.current = false;
        setSnack( { message: "Reverted to last saved.", severity: "success" } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // Cancel — discard any unsynced local edits (reload the last saved version) and leave edit mode
    async function cancelEdits() : Promise<void>
    {
        await revertToSaved();
        setEditable( false );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // the base video track (bottom lane) and the overlay track (top lane) — where new media / text land
    function videoTrackId() : string { const tracks : Array<StudioProject.TimelineTrack> = docRef.current.tracks ?? []; return tracks.length > 0 ? tracks[ tracks.length - 1 ].id : "track-video"; }
    function overlayTrackId() : string { const tracks : Array<StudioProject.TimelineTrack> = docRef.current.tracks ?? []; return tracks.length > 0 ? tracks[ 0 ].id : "track-overlay"; }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // the audio track, created on the first audio import — where imported audio clips land
    function ensureAudioTrack() : string
    {
        const tracks : Array<StudioProject.TimelineTrack> = docRef.current.tracks ?? [];
        const existing : StudioProject.TimelineTrack | undefined = tracks.find( ( track : StudioProject.TimelineTrack ) : boolean => track.id === "track-audio" );
        if( existing !== undefined ) return existing.id;
        mutate( { ...docRef.current, tracks: [ ...tracks, { id: "track-audio", name: "Audio" } ] } );
        return "track-audio";
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // the end of a track's content, so appended clips don't overlap
    function trackEnd( trackId : string ) : number
    {
        return ( docRef.current.clips ?? [] )
            .filter( ( clip : StudioProject.TimelineClip ) : boolean => clip.trackId === trackId )
            .reduce( ( max : number, clip : StudioProject.TimelineClip ) : number => Math.max( max, clip.startSec + clip.durationSec ), 0 );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // append clips to the timeline (single mutation)
    function addClips( added : Array<StudioProject.TimelineClip> ) : void
    {
        if( added.length === 0 ) return;
        mutate( { ...docRef.current, clips: [ ...( docRef.current.clips ?? [] ), ...added ] } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // library picks (image / video / audio) → append each to its natural track (audio → audio track, image/
    // video → base video track), packed end-to-end per track so nothing overlaps on insert
    function onLibraryPick( picks : Array<StudioLibraryPickerDialog.Pick> ) : void
    {
        setLibraryOpen( false );
        if( picks.length === 0 ) return;
        const cursors : Map<string, number> = new Map<string, number>();
        const added : Array<StudioProject.TimelineClip> = picks.map( ( pick : StudioLibraryPickerDialog.Pick, index : number ) : StudioProject.TimelineClip =>
        {
            const isVideo : boolean = pick.kind === Media.Kind.VIDEO;
            const isAudio : boolean = pick.kind === Media.Kind.AUDIO;
            const kind : StudioProject.VideoSceneKind = isAudio ? StudioProject.VideoSceneKind.AUDIO : isVideo ? StudioProject.VideoSceneKind.VIDEO : StudioProject.VideoSceneKind.IMAGE;
            const trackId : string = isAudio ? ensureAudioTrack() : videoTrackId();
            // time-based media drops in at its FULL source length (you trim it shorter after); stills use a preset
            const sourceDurationSec : number | undefined = ( isVideo || isAudio ) ? pick.durationSec : undefined;
            const preset : number = isAudio ? StudioVideoEditor.DEFAULT_AUDIO_SEC : isVideo ? StudioVideoEditor.DEFAULT_VIDEO_SEC : StudioVideoEditor.DEFAULT_IMAGE_SEC;
            const duration : number = sourceDurationSec !== undefined ? sourceDurationSec : preset;
            const startSec : number = cursors.get( trackId ) ?? trackEnd( trackId );
            cursors.set( trackId, startSec + duration );
            return { id: `clip-${ Date.now() }-${ index }`, trackId, kind, startSec, durationSec: duration, sourceDurationSec, src: pick.url, assetGuid: pick.guid, name: pick.name };
        } );
        addClips( added );
        void tagPicksToCampaign( picks );
    }

    // assign each picked library asset to this project's campaign (non-destructive — merge, best-effort)
    async function tagPicksToCampaign( picks : Array<StudioLibraryPickerDialog.Pick> ) : Promise<void>
    {
        const campaignId : string | undefined = props.project.campaignId;
        if( campaignId === undefined || campaignId === "" ) return;
        for( const pick of picks )
        {
            if( ( pick.campaignIds ?? [] ).includes( campaignId ) ) continue;   // already tagged
            const campaignIds : Array<string> = Array.from( new Set<string>( [ ...( pick.campaignIds ?? [] ), campaignId ] ) );
            const tagged : RestfulService.Reply<PatchAsset.Response> = await appmodel.server.fetch( new PatchAsset( pick.guid, { campaignIds } ) );
            if( !tagged.ok ) { /* best-effort */ }
        }
    }

    //////////////////////////////////////////////////////////////////////
    // imported files (image / video / AUDIO) → tag the campaign, resolve a URL, append the right clip kind to
    // its natural track (audio lands on the audio track, image/video on the base video track)
    async function onUploaded( assets : Array<Media.Asset> ) : Promise<void>
    {
        setUploadOpen( false );
        for( let index : number = 0; index < assets.length; index++ )
        {
            const asset : Media.Asset = assets[ index ];
            if( props.project.campaignId && props.project.campaignId !== "" )
            {
                const tagged : RestfulService.Reply<PatchAsset.Response> = await appmodel.server.fetch( new PatchAsset( asset.guid, { campaignIds: [ props.project.campaignId ] } ) );
                if( !tagged.ok ) { /* best-effort */ }
            }
            const isVideo : boolean = asset.kind === Media.Kind.VIDEO;
            const isAudio : boolean = asset.kind === Media.Kind.AUDIO;
            const kind : StudioProject.VideoSceneKind = isAudio ? StudioProject.VideoSceneKind.AUDIO : isVideo ? StudioProject.VideoSceneKind.VIDEO : StudioProject.VideoSceneKind.IMAGE;
            const target : string = isAudio ? ensureAudioTrack() : videoTrackId();
            // time-based media drops in at its FULL probed length (trim shorter later); stills use a preset
            const original : Media.Item | undefined = Media.originalItem( asset );
            const sourceDurationSec : number | undefined = ( isVideo || isAudio ) ? ( original?.meta?.video?.durationSec ?? original?.meta?.audio?.durationSec ) : undefined;
            const preset : number = isAudio ? StudioVideoEditor.DEFAULT_AUDIO_SEC : isVideo ? StudioVideoEditor.DEFAULT_VIDEO_SEC : StudioVideoEditor.DEFAULT_IMAGE_SEC;
            const duration : number = sourceDurationSec !== undefined ? sourceDurationSec : preset;
            // ADD the clip immediately (assetGuid is durable → the render resolves bytes from it regardless);
            // resolve the preview URL with a short retry, since a just-imported asset is briefly SCANNING (403)
            const clipId : string = `clip-${ Date.now() }-${ index }`;
            addClips( [ { id: clipId, trackId: target, kind, startSec: trackEnd( target ), durationSec: duration, sourceDurationSec, assetGuid: asset.guid, name: asset.name } ] );
            void resolveClipSrc( clipId, asset.guid );
        }
    }

    // resolve a clip's preview URL, retrying while the asset finishes scanning/processing (a just-imported /
    // just-uploaded asset is briefly non-servable); patch the clip's `src` in place once it resolves
    async function resolveClipSrc( clipId : string, guid : string ) : Promise<void>
    {
        for( let attempt : number = 0; attempt < StudioVideoEditor.URL_RETRIES; attempt++ )
        {
            const url : RestfulService.Reply<GetMediaUrl.Response> = await appmodel.server.fetch( new GetMediaUrl( guid ) );
            if( url.ok && url.data ) { updateClip( clipId, { src: url.data.url } ); return; }
            await new Promise<void>( ( resolve : () => void ) : void => { setTimeout( resolve, StudioVideoEditor.URL_RETRY_MS ); } );
        }
    }

    //////////////////////////////////////////////////////////////////////
    // provider imports (stock/AI images, saved to the library) → append like any uploaded asset
    function onProvidersImported( assets : Array<Media.Asset> ) : void
    { setProvidersOpen( false ); void onUploaded( assets ); }

    //////////////////////////////////////////////////////////////////////
    // add a text clip on the overlay track, starting at the playhead
    function addTextClip() : void
    {
        const clip : StudioProject.TimelineClip = { id: `text-${ Date.now() }`, trackId: overlayTrackId(), kind: StudioProject.VideoSceneKind.TEXT, startSec: currentSec, durationSec: StudioVideoEditor.DEFAULT_TEXT_SEC, text: "Your text", xPct: 0.5, yPct: 0.5, fontPct: StudioProject.DEFAULT_TEXT_GEOMETRY.fontPct, align: "center" };
        addClips( [ clip ] );
        setSelectedClipId( clip.id );
    }

    //////////////////////////////////////////////////////////////////////
    // add a SOLID color card on the base video track at the playhead (a background / title backdrop)
    function addSolid() : void
    {
        const clip : StudioProject.TimelineClip = { id: `solid-${ Date.now() }`, trackId: videoTrackId(), kind: StudioProject.VideoSceneKind.SOLID, startSec: currentSec, durationSec: StudioVideoEditor.DEFAULT_IMAGE_SEC, color: "#000000" };
        addClips( [ clip ] );
        setSelectedClipId( clip.id );
    }

    //////////////////////////////////////////////////////////////////////
    // add an SVG SHAPE/graphic overlay on the overlay track — defaults to a centered ~40% rectangle (contain
    // fit so it isn't cropped); pick the actual shape + fill/stroke in the inspector
    function addShape() : void
    {
        const clip : StudioProject.TimelineClip = { id: `shape-${ Date.now() }`, trackId: overlayTrackId(), kind: StudioProject.VideoSceneKind.SHAPE, startSec: currentSec, durationSec: StudioVideoEditor.DEFAULT_IMAGE_SEC,
            shape: "rectangle", shapeStyle: { ...StudioProject.DEFAULT_SHAPE_STYLE }, transform: { ...StudioProject.DEFAULT_CLIP_TRANSFORM, scale: 0.4, fit: StudioProject.FitMode.CONTAIN } };
        addClips( [ clip ] );
        setSelectedClipId( clip.id );
    }

    //////////////////////////////////////////////////////////////////////
    // drop in a text TEMPLATE (title / lower-third / caption) — each layer becomes a styled text clip on the
    // overlay track at the playhead, all sharing a start so they animate/appear together
    function addTextTemplate( template : string ) : void
    {
        const definition : StudioProject.TextTemplateDef | undefined = StudioProject.TEXT_TEMPLATES.find( ( entry : StudioProject.TextTemplateDef ) : boolean => entry.template === template );
        if( definition === undefined ) return;
        const now : number = Date.now();
        const trackId : string = overlayTrackId();
        const added : Array<StudioProject.TimelineClip> = definition.layers.map( ( layer : StudioProject.TextTemplateLayer, index : number ) : StudioProject.TimelineClip =>
            ( { id: `text-${ now }-${ index }`, trackId, kind: StudioProject.VideoSceneKind.TEXT, startSec: currentSec, durationSec: StudioVideoEditor.DEFAULT_TEXT_SEC, text: layer.text, xPct: layer.xPct, yPct: layer.yPct, fontPct: layer.fontPct, align: layer.align, style: layer.style } ) );
        addClips( added );
        if( added.length > 0 ) setSelectedClipId( added[ 0 ].id );
    }

    //////////////////////////////////////////////////////////////////////
    // DETACH AUDIO — split a video clip's soundtrack into its own AUDIO clip on the audio track (same asset +
    // timing), then silence the source video's audio so the two don't double up in the mix
    function detachAudio( clip : StudioProject.TimelineClip ) : void
    {
        if( clip.kind !== StudioProject.VideoSceneKind.VIDEO || clip.assetGuid === undefined ) return;
        const audioClip : StudioProject.TimelineClip =
            { id: `audio-${ Date.now() }`, trackId: ensureAudioTrack(), kind: StudioProject.VideoSceneKind.AUDIO, startSec: clip.startSec, durationSec: clip.durationSec, trimStartSec: clip.trimStartSec, sourceDurationSec: clip.sourceDurationSec, src: clip.src, assetGuid: clip.assetGuid, name: `${ clip.name ?? "Audio" } (audio)`, volume: clip.volume };
        // silence the source video's audio (volume 0 drops it from the render's amix) and add the detached clip
        updateClip( clip.id, { volume: 0 } );
        addClips( [ audioClip ] );
        setSelectedClipId( audioClip.id );
    }

    //////////////////////////////////////////////////////////////////////
    // AUTO-CAPTIONS — turn a video/audio clip's speech transcript into timed caption text clips. If the source
    // asset has no transcript yet, kick off the transcribe job and ask the user to retry once it lands.
    async function generateCaptions( clip : StudioProject.TimelineClip ) : Promise<void>
    {
        if( clip.assetGuid === undefined ) return;
        // fetch the source asset and look for the transcript the transcribe job stores on it
        const reply : RestfulService.Reply<GetAsset.Response> = await appmodel.server.fetch( new GetAsset( clip.assetGuid ) );
        if( !reply.ok || reply.data === undefined ) { setSnack( { message: "Could not load the clip's asset.", severity: "error" } ); return; }
        const transcriptItem : Media.Item | undefined = Media.findItem( reply.data.asset, Media.Usage.TRANSCRIPT );
        const segments : Array<Media.TranscriptSegment> = transcriptItem?.meta?.document?.transcript?.segments ?? [];

        // no transcript yet → start transcription; the caption action is retried once it completes
        if( segments.length === 0 )
        {
            const started : RestfulService.Reply<PostAssetTranscribe.Response> = await appmodel.server.fetch( new PostAssetTranscribe( clip.assetGuid ) );
            setSnack( started.ok
                ? { message: "Transcribing… captions will be available shortly. Try again in a moment.", severity: "info" }
                : { message: "Could not start transcription.", severity: "error" } );
            return;
        }

        // map each timed segment → a caption clip, offset onto the timeline by the clip's position (minus its
        // trim in-point) and clamped to the clip's visible window; segments outside it (or blank) are skipped
        const now : number = Date.now();
        const trackId : string = overlayTrackId();
        const trimStart : number = clip.trimStartSec ?? 0;
        const clipEnd : number = clip.startSec + clip.durationSec;
        const captions : Array<StudioProject.TimelineClip> = [];
        for( let index : number = 0; index < segments.length; index++ )
        {
            const segment : Media.TranscriptSegment = segments[ index ];
            const from : number = Math.max( clip.startSec, clip.startSec + ( segment.start - trimStart ) );
            const to : number = Math.min( clipEnd, clip.startSec + ( segment.end - trimStart ) );
            const line : string = segment.text.trim();
            if( to <= from || line === "" ) continue;
            captions.push( { id: `cap-${ now }-${ index }`, trackId, kind: StudioProject.VideoSceneKind.TEXT, startSec: from, durationSec: to - from, text: line, xPct: StudioProject.CAPTION_GEOMETRY.xPct, yPct: StudioProject.CAPTION_GEOMETRY.yPct, fontPct: StudioProject.CAPTION_GEOMETRY.fontPct, align: StudioProject.CAPTION_GEOMETRY.align, style: StudioProject.CAPTION_STYLE } );
        }
        if( captions.length === 0 ) { setSnack( { message: "No caption segments fell within this clip.", severity: "warning" } ); return; }
        addClips( captions );
        setSnack( { message: `Added ${ captions.length } caption${ captions.length === 1 ? "" : "s" }.`, severity: "success" } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // clip mutations (from the timeline drag/resize + the inspector)
    function updateClip( id : string, patch : Partial<StudioProject.TimelineClip> ) : void
    {
        mutate( { ...docRef.current, clips: ( docRef.current.clips ?? [] ).map( ( clip : StudioProject.TimelineClip ) : StudioProject.TimelineClip => clip.id === id ? { ...clip, ...patch } : clip ) } );
    }
    function removeClip( id : string ) : void
    {
        if( selectedClipId === id ) setSelectedClipId( null );
        mutate( { ...docRef.current, clips: ( docRef.current.clips ?? [] ).filter( ( clip : StudioProject.TimelineClip ) : boolean => clip.id !== id ) } );
    }

    //////////////////////////////////////////////////////////////////////
    // remove ALL selected clips (bulk) — or just the primary when only one is selected
    function removeSelected() : void
    {
        if( selection.length <= 1 ) { if( selectedClipId !== null ) removeClip( selectedClipId ); return; }
        const ids : Set<string> = new Set( selection );
        setSelection( [] );
        mutate( { ...docRef.current, clips: ( docRef.current.clips ?? [] ).filter( ( clip : StudioProject.TimelineClip ) : boolean => !ids.has( clip.id ) ) } );
    }

    //////////////////////////////////////////////////////////////////////
    // RIPPLE delete — remove the selected clip and slide every LATER clip on the SAME track left to close the gap
    function rippleDeleteSelected() : void
    {
        const clip : StudioProject.TimelineClip | null = selectedClip;
        if( clip === null ) return;
        const gap : number = clip.durationSec;
        const clipEnd : number = clip.startSec + clip.durationSec;
        const remaining : Array<StudioProject.TimelineClip> = ( docRef.current.clips ?? [] ).filter( ( entry : StudioProject.TimelineClip ) : boolean => entry.id !== clip.id );
        const shifted : Array<StudioProject.TimelineClip> = remaining.map( ( entry : StudioProject.TimelineClip ) : StudioProject.TimelineClip =>
            entry.trackId === clip.trackId && entry.startSec >= clipEnd ? { ...entry, startSec: Math.max( 0, entry.startSec - gap ) } : entry );
        setSelectedClipId( null );
        mutate( { ...docRef.current, clips: shifted } );
    }

    //////////////////////////////////////////////////////////////////////
    // move a clip, PREVENTING same-track overlap: clamp its start into the gap around the requested position
    // (floor at the end of clips before it, ceiling at the start of clips after it, minus its own duration)
    function moveClip( id : string, startSec : number, trackId : string ) : void
    {
        const clip : StudioProject.TimelineClip | undefined = ( docRef.current.clips ?? [] ).find( ( entry : StudioProject.TimelineClip ) : boolean => entry.id === id );
        const duration : number = clip?.durationSec ?? 0;
        const others : Array<StudioProject.TimelineClip> = ( docRef.current.clips ?? [] ).filter( ( entry : StudioProject.TimelineClip ) : boolean => entry.id !== id && entry.trackId === trackId );
        let lower : number = 0;
        let upper : number = Number.POSITIVE_INFINITY;
        for( const other of others )
        {
            const otherEnd : number = other.startSec + other.durationSec;
            if( otherEnd <= startSec ) lower = Math.max( lower, otherEnd );                     // sits entirely before → floor
            else if( other.startSec >= startSec + duration ) upper = Math.min( upper, other.startSec );   // entirely after → ceiling
            else if( startSec + duration / 2 < other.startSec + other.durationSec / 2 ) upper = Math.min( upper, other.startSec );   // overlaps, we're left of it → push before
            else lower = Math.max( lower, otherEnd );                                           // overlaps, we're right of it → push after
        }
        // clamp into [lower, upper - duration]; if the gap is too small, sit at the floor (best effort — the
        // drop handler relocates to a new track when the release position turns out to be occupied)
        const clamped : number = upper - lower < duration ? lower : Math.max( lower, Math.min( startSec, upper - duration ) );
        updateClip( id, { startSec: Math.max( 0, clamped ), trackId } );
    }

    //////////////////////////////////////////////////////////////////////
    // finalize a MOVE drop: if the released position is FREE on the target track, place the clip exactly there;
    // if it's OCCUPIED (no room), auto-add a new track and drop the clip onto it at that time position
    function dropClip( id : string, startSec : number, trackId : string ) : void
    {
        const doc : StudioProject.VideoDoc = docRef.current;
        const clip : StudioProject.TimelineClip | undefined = ( doc.clips ?? [] ).find( ( entry : StudioProject.TimelineClip ) : boolean => entry.id === id );
        if( clip === undefined ) return;
        const start : number = Math.max( 0, startSec );
        const duration : number = clip.durationSec;
        // does [start, start+duration] intersect any other clip on the target track?
        const occupied : boolean = ( doc.clips ?? [] ).some( ( other : StudioProject.TimelineClip ) : boolean =>
            other.id !== id && other.trackId === trackId && start < other.startSec + other.durationSec && start + duration > other.startSec );
        if( !occupied ) { moveClip( id, start, trackId ); return; }
        // no room here → mint a new track (on top, matching addTrack) and move the clip onto it at `start`
        const track : StudioProject.TimelineTrack = { id: `track-${ Date.now() }`, name: `Track ${ ( doc.tracks ?? [] ).length + 1 }` };
        const clips : Array<StudioProject.TimelineClip> = ( doc.clips ?? [] ).map( ( entry : StudioProject.TimelineClip ) : StudioProject.TimelineClip => entry.id === id ? { ...entry, startSec: start, trackId: track.id } : entry );
        mutate( { ...doc, tracks: [ track, ...( doc.tracks ?? [] ) ], clips } );
    }

    //////////////////////////////////////////////////////////////////////
    // resize a clip, PREVENTING same-track overlap: clamp the head to the previous clip's end (trimming the
    // in-point to keep the out-point fixed) and the tail to the next clip's start
    function resizeClip( id : string, startSec : number, durationSec : number, trimStartSec : number ) : void
    {
        const doc : StudioProject.VideoDoc = docRef.current;
        const clip : StudioProject.TimelineClip | undefined = ( doc.clips ?? [] ).find( ( entry : StudioProject.TimelineClip ) : boolean => entry.id === id );
        const others : Array<StudioProject.TimelineClip> = ( doc.clips ?? [] ).filter( ( entry : StudioProject.TimelineClip ) : boolean => entry.id !== id && entry.trackId === clip?.trackId );
        let leftBound : number = 0;
        let rightBound : number = Number.POSITIVE_INFINITY;
        for( const other of others )
        {
            const otherEnd : number = other.startSec + other.durationSec;
            if( other.startSec <= startSec ) leftBound = Math.max( leftBound, otherEnd );   // neighbor on the left / overlapping the head
            else rightBound = Math.min( rightBound, other.startSec );                        // neighbor on the right
        }
        let start : number = startSec;
        let duration : number = durationSec;
        let trim : number = trimStartSec;
        if( start < leftBound ) { const shift : number = leftBound - start; start = leftBound; duration -= shift; trim += shift; }   // push the in-point right
        if( start + duration > rightBound ) duration = rightBound - start;                                                          // cap the out-point
        duration = Math.max( StudioTimeline.GRID_SEC, duration );
        trim = Math.max( 0, trim );
        updateClip( id, { startSec: Math.max( 0, start ), durationSec: duration, trimStartSec: trim } );
    }

    // split the SELECTED clip at the playhead into two clips (a hard cut). The left keeps the head (+ fade-in),
    // the right takes the tail with its source in-point advanced (+ fade-out); the fade at the cut is dropped.
    function splitSelected() : void
    {
        const clip : StudioProject.TimelineClip | null = selectedClip;
        if( clip === null || !canSplit ) return;
        const cut           : number = currentSec;
        const leftDuration  : number = cut - clip.startSec;
        const rightDuration : number = ( clip.startSec + clip.durationSec ) - cut;
        const rightId       : string = `clip-${ Date.now() }`;
        const left          : StudioProject.TimelineClip = { ...clip, durationSec: leftDuration, fadeOutSec: undefined };
        const right         : StudioProject.TimelineClip = { ...clip, id: rightId, startSec: cut, durationSec: rightDuration, trimStartSec: ( clip.trimStartSec ?? 0 ) + leftDuration, fadeInSec: undefined };
        mutate( { ...docRef.current, clips: ( docRef.current.clips ?? [] ).flatMap( ( entry : StudioProject.TimelineClip ) : Array<StudioProject.TimelineClip> => entry.id === clip.id ? [ left, right ] : [ entry ] ) } );
        setSelectedClipId( rightId );
    }

    //////////////////////////////////////////////////////////////////////
    // COPY the selected clip to the buffer AND localStorage, so paste works ACROSS projects (not just this editor)
    function copySelected() : void
    {
        if( selectedClip === null ) return;
        clipboard.current = { ...selectedClip };
        appmodel.localStorage.set( StudioVideoEditor.CLIPBOARD_KEY, JSON.stringify( selectedClip ) );
    }

    // PASTE the clipboard clip at the playhead — a fresh id, and its track remapped to one that exists in THIS
    // project (by kind) so a cross-project paste lands somewhere valid. assetGuid is durable; src may be stale.
    function pasteClip() : void
    {
        let source : StudioProject.TimelineClip | null = clipboard.current;
        if( source === null )
        {
            const stored : string = appmodel.localStorage.get( StudioVideoEditor.CLIPBOARD_KEY ) ?? "";
            if( stored !== "" ) { try { source = JSON.parse( stored ) as StudioProject.TimelineClip; } catch { source = null; } }
        }
        if( source === null ) return;
        const tracks : Array<StudioProject.TimelineTrack> = docRef.current.tracks ?? [];
        const hasTrack : boolean = tracks.some( ( track : StudioProject.TimelineTrack ) : boolean => track.id === source.trackId );
        const trackId : string = hasTrack ? source.trackId
            : source.kind === StudioProject.VideoSceneKind.TEXT ? overlayTrackId()
            : source.kind === StudioProject.VideoSceneKind.AUDIO ? ensureAudioTrack()
            : videoTrackId();
        const copy : StudioProject.TimelineClip = { ...source, id: `clip-${ Date.now() }`, startSec: Math.max( 0, currentSecRef.current ), trackId };
        addClips( [ copy ] );
        setSelectedClipId( copy.id );
    }

    //////////////////////////////////////////////////////////////////////
    // duplicate the SELECTED clip — a copy on the same track, placed immediately after the original
    function duplicateSelected() : void
    {
        const clip : StudioProject.TimelineClip | null = selectedClip;
        if( clip === null ) return;
        const copy : StudioProject.TimelineClip = { ...clip, id: `clip-${ Date.now() }`, startSec: clip.startSec + clip.durationSec };
        addClips( [ copy ] );
        setSelectedClipId( copy.id );
    }

    //////////////////////////////////////////////////////////////////////
    // track mutations
    function addTrack() : void
    {
        const tracks : Array<StudioProject.TimelineTrack> = docRef.current.tracks ?? [];
        const track : StudioProject.TimelineTrack = { id: `track-${ Date.now() }`, name: `Track ${ tracks.length + 1 }` };
        mutate( { ...docRef.current, tracks: [ track, ...tracks ] } );
    }

    //////////////////////////////////////////////////////////////////////
    function updateTrack( id : string, patch : Partial<StudioProject.TimelineTrack> ) : void
    {
        mutate( { ...docRef.current, tracks: ( docRef.current.tracks ?? [] ).map( ( track : StudioProject.TimelineTrack ) : StudioProject.TimelineTrack => track.id === id ? { ...track, ...patch } : track ) } );
    }

    //////////////////////////////////////////////////////////////////////
    function removeTrack( id : string ) : void
    {
        mutate( { ...docRef.current,
                  tracks: ( docRef.current.tracks ?? [] ).filter( ( track : StudioProject.TimelineTrack ) : boolean => track.id !== id ),
                  clips: ( docRef.current.clips ?? [] ).filter( ( clip : StudioProject.TimelineClip ) : boolean => clip.trackId !== id ) } );
    }
    // apply a drag-reordered track order (the timeline hands back the full new id sequence)
    function reorderTracks( orderedIds : Array<string> ) : void
    {
        const tracks : Array<StudioProject.TimelineTrack> = docRef.current.tracks ?? [];
        const next : Array<StudioProject.TimelineTrack> = orderedIds
            .map( ( id : string ) : StudioProject.TimelineTrack | undefined => tracks.find( ( track : StudioProject.TimelineTrack ) : boolean => track.id === id ) )
            .filter( ( track : StudioProject.TimelineTrack | undefined ) : track is StudioProject.TimelineTrack => track !== undefined );
        if( next.length !== tracks.length ) return;   // guard: only apply a full, valid permutation
        mutate( { ...docRef.current, tracks: next } );
    }
    function toggleMuted( id : string ) : void { const track : StudioProject.TimelineTrack | undefined = ( docRef.current.tracks ?? [] ).find( ( entry : StudioProject.TimelineTrack ) : boolean => entry.id === id ); updateTrack( id, { muted: !( track?.muted ?? false ) } ); }
    function toggleHidden( id : string ) : void { const track : StudioProject.TimelineTrack | undefined = ( docRef.current.tracks ?? [] ).find( ( entry : StudioProject.TimelineTrack ) : boolean => entry.id === id ); updateTrack( id, { hidden: !( track?.hidden ?? false ) } ); }

    //////////////////////////////////////////////////////////////////////
    // composition settings (inspector, no clip selected)
    function setFormat( key : string ) : void
    {
        const format : StudioProject.VideoFormat | undefined = StudioProject.VIDEO_FORMATS.find( ( entry : StudioProject.VideoFormat ) : boolean => entry.key === key );
        if( format === undefined ) return;
        mutate( { ...docRef.current, width: format.width, height: format.height } );
    }

    //////////////////////////////////////////////////////////////////////
    function setTargets( keys : Array<string> ) : void
    { mutate( { ...docRef.current, targets: keys } ); }

    //////////////////////////////////////////////////////////////////////
    function setQuality( key : string ) : void
    { mutate( { ...docRef.current, quality: key as StudioProject.VideoQuality } ); }

    //////////////////////////////////////////////////////////////////////
    function setBitrate( kbps : number ) : void
    { mutate( { ...docRef.current, bitrateKbps: Math.max( 0, Math.round( kbps ) ) } ); }

    // poster: ON pins the poster frame to the current playhead; OFF clears it. GIF: toggle the extra GIF export.
    function togglePoster( on : boolean ) : void
    { mutate( { ...docRef.current, posterSec: on ? Math.max( 0, currentSecRef.current ) : undefined } ); }
    function setGif( on : boolean ) : void
    { mutate( { ...docRef.current, gif: on } ); }

    //////////////////////////////////////////////////////////////////////
    // set (or clear) the doc-level logo/watermark — a persistent overlay burned over the whole timeline
    function setWatermark( watermark : StudioProject.Watermark | undefined ) : void
    { mutate( { ...docRef.current, watermark } ); }

    //////////////////////////////////////////////////////////////////////
    // a watermark image was chosen from the library → seed the default placement with the picked asset
    // (assetGuid is durable → the render resolves bytes from it; src is the time-limited preview URL)
    function onWatermarkPicked( picks : Array<StudioLibraryPickerDialog.Pick> ) : void
    {
        setWatermarkPickOpen( false );
        if( picks.length === 0 ) return;
        const pick : StudioLibraryPickerDialog.Pick = picks[ 0 ];
        setWatermark( { ...StudioProject.DEFAULT_WATERMARK, assetGuid: pick.guid, src: pick.url } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // playback — drive the Player through its ref (custom playback bar + timeline scrubbing)
    function togglePlay() : void
    { playerRef.current?.toggle(); }

    //////////////////////////////////////////////////////////////////////
    function seek( sec : number ) : void
    {
        const clamped : number = Math.max( 0, Math.min( totalSec, sec ) );
        setCurrentSec( clamped );
        playerRef.current?.seekTo( Math.round( clamped * doc.fps ) );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // Render & Export — flush the timeline, then enqueue a server-side ffmpeg render → mp4(s) saved to library
    async function renderAndSave() : Promise<void>
    {
        if( !hasClips ) { setSnack( { message: "Add clips before rendering.", severity: "info" } ); return; }
        if( dirty.current ) await syncServer();   // make sure the server has the latest timeline to render
        const reply : RestfulService.Reply<PostStudioRender.Response> = await appmodel.server.fetch( new PostStudioRender( props.project.id ) );
        if( !reply.ok ) { setSnack( { message: "Could not start the render.", severity: "error" } ); return; }
        setSnack( { message: "Rendering… it'll appear in the library when done.", severity: "success" } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // m:ss:ff timecode (minutes : seconds : frame-within-second) for the playback bar
    function timecode( seconds : number ) : string
    {
        const minutes : number = Math.floor( seconds / 60 );
        const secs : number = Math.floor( seconds % 60 );
        const frames : number = Math.floor( ( seconds - Math.floor( seconds ) ) * doc.fps );
        return `${ minutes }:${ String( secs ).padStart( 2, "0" ) }:${ String( frames ).padStart( 2, "0" ) }`;
    }

    //////////////////////////////////////////////////////////////////////
    // created/modified stamp for the footer
    function formatWhen( iso : string ) : string
    { return appmodel.ui.locale.dateTime( new Date( iso ), LocaleService.Format.SHORT ) || "—"; }

    // the acting user (create/modify) as a chip — name/email is the id/email we store on the project
    function whoChip( who? : string ) : JSX.Element | null
    { return who && who.trim() !== "" ? <UserChip size="small" name={ who } email={ who } /> : null; }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // the footer save-state chip
    function saveChip() : JSX.Element
    {
        if( saveState === StudioVideoEditor.SaveState.SYNCING )
            return <ChipStatus size="small" status={ Colors.Status.INWORK } icon={ <CloudSyncOutlinedIcon /> } label={"Syncing…"} />;
        if( saveState === StudioVideoEditor.SaveState.LOCAL )
            return <ChipStatus size="small" status={ Colors.Status.PENDING } icon={ <CloudQueueOutlinedIcon /> } label={"Saved locally"} />;
        if( saveState === StudioVideoEditor.SaveState.SYNCED )
            return <ChipStatus size="small" status={ Colors.Status.ACTIVE } icon={ <CloudDoneOutlinedIcon /> } label={ syncedAt ? `Synced ${ appmodel.ui.locale.time( new Date( syncedAt ), LocaleService.Format.SHORT ) }` : "Synced" } />;
        return <ChipStatus size="small" status={ Colors.Status.INACTIVE } icon={ <CloudDoneOutlinedIcon /> } label={"Autosave on"} />;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    return  <Box sx={{ height: "100%", minHeight: 0, display: "flex", flexDirection: "column" }}>

                {/* ACTION ROW — editing tools only (hidden in read-only; Edit lives in the studio banner) */}
                { !readonly &&
                    <Stack direction="row" spacing={ 1 } sx={{ alignItems: "center", px: 1.5, py: 0.75, borderBottom: 1, borderColor: "divider", flexShrink: 0, flexWrap: "wrap", rowGap: 1 }}>
                        {/* add-media sources now live on the timeline toolbar (below); this row is export/save actions */}
                        <Pusher />
                        <Button size="small" startIcon={ <MovieCreationOutlinedIcon /> } onClick={ () : void => void renderAndSave() }>{"Export"}</Button>
                        <Button size="small" color="inherit" startIcon={ <CloseOutlinedIcon /> } onClick={ () : void => void cancelEdits() }>{"Cancel"}</Button>
                        <Button size="small" variant="contained" startIcon={ <LockOutlinedIcon /> } onClick={ () : void => setEditable( false ) }>{"Save"}</Button>
                    </Stack> }

                {/* MIDDLE — stage (player + playback) beside the inspector */}
                <Box sx={{ display: "flex", flexGrow: 1, minHeight: 0 }}>
                    <Box sx={{ display: "flex", flexDirection: "column", flexGrow: 1, minWidth: 0 }}>
                        {/* PLAYER */}
                        <Box sx={{ flexGrow: 1, minHeight: 0, display: "flex", alignItems: "center", justifyContent: "center", bgcolor: "action.hover", p: 2 }}>
                            { !hasClips
                                ? <Stack sx={{ alignItems: "center", color: "text.secondary" }}>
                                      <AudiotrackOutlinedIcon sx={{ fontSize: 40, color: "text.disabled" }} />
                                      <Typography variant="body2" sx={{ mt: 1 }}>{ readonly ? "Empty video — click Edit to add clips." : "Add images, clips, or text to build the video." }</Typography>
                                  </Stack>
                                : <Box sx={{ width: "100%", height: "100%", maxWidth: "100%" }}>
                                      <Player ref={ playerRef } component={ StudioVideoComposition }
                                              inputProps={ playerInputProps }
                                              durationInFrames={ playerDuration }
                                              fps={ doc.fps }
                                              compositionWidth={ doc.width }
                                              compositionHeight={ doc.height }
                                              style={ StudioVideoEditor.PLAYER_STYLE } />
                                  </Box> }
                        </Box>
                        {/* PLAYBACK bar */}
                        <Stack direction="row" spacing={ 1 } sx={{ alignItems: "center", justifyContent: "center", px: 1.5, py: 0.5, borderTop: 1, borderColor: "divider", flexShrink: 0 }}>
                            <ButtonIcon id="pb-start" label={"Jump to start"} disabled={ !hasClips } icon={ <SkipPreviousOutlinedIcon /> } onClick={ () : void => seek( 0 ) } />
                            <ButtonIcon id="pb-play" label={ playing ? "Pause" : "Play" } disabled={ !hasClips } icon={ playing ? <PauseOutlinedIcon /> : <PlayCircleFilledOutlinedIcon /> } onClick={ togglePlay } />
                            <ButtonIcon id="pb-end" label={"Jump to end"} disabled={ !hasClips } icon={ <SkipNextOutlinedIcon /> } onClick={ () : void => seek( totalSec ) } />
                            <Typography variant="caption"
                                        sx={{ color: "text.secondary", fontVariantNumeric: "tabular-nums", pl: 2 }}>{ `${ timecode( currentSec ) } / ${ timecode( totalSec ) }` }</Typography>
                        </Stack>
                    </Box>

                    {/* INSPECTOR — only while editing (hidden in read-only/after Save) */}
                    { !readonly &&
                        <Box sx={{ width: 300, flexShrink: 0, borderLeft: 1, borderColor: "divider", minHeight: 0 }}>
                            <StudioClipInspector doc={ doc } clip={ selectedClip } readonly={ readonly }
                                                 watermark={ doc.watermark }
                                                 onChangeClip={ updateClip } onRemoveClip={ removeClip }
                                                 onSetFormat={ setFormat } onSetTargets={ setTargets } onSetQuality={ setQuality } onSetBitrate={ setBitrate }
                                                 onTogglePoster={ togglePoster } onSetGif={ setGif }
                                                 onPickWatermark={ () : void => setWatermarkPickOpen( true ) } onSetWatermark={ setWatermark }
                                                 onGenerateCaptions={ ( clip : StudioProject.TimelineClip ) : void => void generateCaptions( clip ) }
                                                 onDetachAudio={ detachAudio } />
                        </Box> }
                </Box>

                {/* TIMELINE — only while editing */}
                { !readonly &&
                    <Box sx={{ height: 260, flexShrink: 0, borderTop: 1, borderColor: "divider" }}>
                        <StudioTimeline doc={ doc }
                                        pxPerSec={ pxPerSec }
                                        currentSec={ currentSec }
                                        selectedClipId={ selectedClipId }
                                        selectedClipIds={ selection }
                                        onToggleSelect={ toggleSelect }
                                        readonly={ readonly }
                                        canSplit={ canSplit }
                                        canDuplicate={ selectedClip !== null }
                                        canUndo={ historyState.canUndo }
                                        canRedo={ historyState.canRedo }
                                        onSelectClip={ setSelectedClipId }
                                        onAddLibrary={ () : void => setLibraryOpen( true ) }
                                        onImportAudio={ () : void => setUploadOpen( true ) }
                                        onAddProviders={ () : void => setProvidersOpen( true ) }
                                        onAddText={ addTextClip }
                                        onAddTemplate={ addTextTemplate }
                                        onAddSolid={ addSolid }
                                        onAddShape={ addShape }
                                        onSplit={ splitSelected }
                                        onDuplicate={ duplicateSelected }
                                        onUndo={ undo }
                                        onRedo={ redo }
                                        onMoveClip={ moveClip }
                                        onDropClip={ dropClip }
                                        onResizeClip={ resizeClip }
                                        onSeek={ seek }
                                        onZoom={ setPxPerSec }
                                        onAddTrack={ addTrack }
                                        onReorderTracks={ reorderTracks }
                                        onToggleMuted={ toggleMuted }
                                        onToggleHidden={ toggleHidden }
                                        onRemoveTrack={ removeTrack } />
                    </Box> }

                {/* FOOTER — summary + the sync chip */}
                <Stack direction="row" spacing={ 2 } sx={{ alignItems: "center", px: 1.5, py: 0.5, borderTop: 1, borderColor: "divider", flexShrink: 0, bgcolor: "background.paper" }}>
                    
                    <Stack direction="column" spacing={ 1 } >
                        <Typography variant="caption" sx={{ color: "text.secondary" }}>{ `${ clips.length } clip${ clips.length === 1 ? "" : "s" } · ${ totalSec.toFixed( 1 ) }s · ${ doc.width }×${ doc.height } @${ doc.fps }fps` }</Typography>
                        <Typography variant="caption" sx={{ color: "text.secondary" }}>{ `${ Math.max( 1, ( doc.targets ?? [] ).length ) } destination${ Math.max( 1, ( doc.targets ?? [] ).length ) === 1 ? "" : "s" }` }</Typography>
                    </Stack>
                    
                    <Stack direction="column" spacing={ 0.5 } >
                        <Stack direction="row" spacing={ 0.75 } sx={{ alignItems: "center" }}>
                            <Typography variant="caption" sx={{ color: "text.disabled" }}>{ `Created: ${ formatWhen( props.project.createdAt ) }` }</Typography>
                            { whoChip( props.project.createdBy ) }
                        </Stack>
                        <Stack direction="row" spacing={ 0.75 } sx={{ alignItems: "center" }}>
                            <Typography variant="caption" sx={{ color: "text.disabled" }}>{ `Modified: ${ formatWhen( props.project.modifiedAt ) }` }</Typography>
                            { whoChip( props.project.modifiedBy ) }
                        </Stack>
                        
                        
                    </Stack>
                    <Pusher />
                    { saveChip() }
                </Stack>

                { libraryOpen &&
                    <StudioLibraryPickerDialog campaignId={ props.project.campaignId } kinds={ StudioVideoEditor.LIBRARY_KINDS } onPick={ onLibraryPick } onClose={ () : void => setLibraryOpen( false ) } /> }

                { watermarkPickOpen &&
                    <StudioLibraryPickerDialog campaignId={ props.project.campaignId } kinds={ StudioVideoEditor.WATERMARK_KINDS } onPick={ onWatermarkPicked } onClose={ () : void => setWatermarkPickOpen( false ) } /> }

                { uploadOpen &&
                    <MediaUploadDialog title={"Import Audio"} scope={ Media.Scope.ACCOUNT } accept={ StudioVideoEditor.IMPORT_ACCEPT } onUploaded={ onUploaded } onClose={ () : void => setUploadOpen( false ) } /> }

                { providersOpen &&
                    <StudioProvidersDialog onImported={ onProvidersImported } onClose={ () : void => setProvidersOpen( false ) } /> }

                { snack && <SnackAlert message={ snack.message } severity={ snack.severity } onClose={ () : void => setSnack( null ) } /> }
            </Box>;
}

export namespace StudioVideoEditor
{
    export const STORAGE_PREFIX : string = "studio.canvas.";   // shared per-project canvas cache key prefix
    export const LOCAL_DEBOUNCE_MS : number = 700;
    export const SYNC_IDLE_MS : number = 8000;
    export const SYNC_MAX_MS : number = 30000;
    export const DEFAULT_IMAGE_SEC : number = 4;   // default duration for an image clip
    export const DEFAULT_VIDEO_SEC : number = 6;   // default duration for a video clip
    export const DEFAULT_TEXT_SEC : number = 3;    // default duration for a text clip
    export const DEFAULT_AUDIO_SEC : number = 10;  // default duration for an imported audio clip

    export const CLIPBOARD_KEY : string = "studio.clipboard.clip";   // localStorage key for cross-project clip copy/paste
    export const HISTORY_LIMIT : number = 50;          // max undo steps retained
    export const HISTORY_COALESCE_MS : number = 500;   // edits within this window merge into one undo step (e.g. a drag)
    export const URL_RETRIES : number = 8;         // preview-URL resolution attempts (asset finishes scanning)
    export const URL_RETRY_MS : number = 900;      // delay between preview-URL attempts

    /** Kinds pickable from the library (image/video/audio) — drives the picker's filter tabs. */
    export const LIBRARY_KINDS : Array<Media.Kind> = [ Media.Kind.IMAGE, Media.Kind.VIDEO, Media.Kind.AUDIO ];

    /** A logo/watermark is an image only. */
    export const WATERMARK_KINDS : Array<Media.Kind> = [ Media.Kind.IMAGE ];
    /** Upload/import is limited to mp3 audio (video/images come from the library / providers). */
    export const IMPORT_ACCEPT : Array<string> = [ "mp3" ];
    /** A stable style object for the Player (avoids a new object each render → no needless Player churn). */
    export const PLAYER_STYLE : React.CSSProperties = { width: "100%", height: "100%" };

    /** The autosave lifecycle shown in the footer (two-tier: local cache vs server sync). */
    export enum SaveState
    {
        IDLE    = "idle",
        LOCAL   = "local",
        SYNCING = "syncing",
        SYNCED  = "synced",
    }

    export interface Props
    {
        project           : StudioProject.Entity;
        editing?          : boolean;                         // CONTROLLED edit mode (parent-owned; Edit lives in the banner)
        onProjectChanged? : ( project : StudioProject.Entity ) => void;
        onEditModeChange? : ( editing : boolean ) => void;   // report lock/unlock so the parent can gate the properties gear
    }
}

export default StudioVideoEditor;
// eof
