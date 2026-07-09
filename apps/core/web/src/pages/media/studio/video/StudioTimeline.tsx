import React from 'react';
import { JSX } from "react";

import { Box, Divider, Slider, Stack, Typography, alpha, useTheme } from "@mui/material";
import { Theme } from "@mui/material/styles";
import AddOutlinedIcon           from '@mui/icons-material/AddOutlined';
import TitleOutlinedIcon         from '@mui/icons-material/TitleOutlined';
import ContentCutOutlinedIcon    from '@mui/icons-material/ContentCutOutlined';
import ContentCopyOutlinedIcon   from '@mui/icons-material/ContentCopyOutlined';
import UndoOutlinedIcon          from '@mui/icons-material/UndoOutlined';
import RedoOutlinedIcon          from '@mui/icons-material/RedoOutlined';
import VolumeUpOutlinedIcon      from '@mui/icons-material/VolumeUpOutlined';
import VolumeOffOutlinedIcon     from '@mui/icons-material/VolumeOffOutlined';
import VisibilityOutlinedIcon    from '@mui/icons-material/VisibilityOutlined';
import VisibilityOffOutlinedIcon from '@mui/icons-material/VisibilityOffOutlined';
import DeleteOutlineOutlinedIcon from '@mui/icons-material/DeleteOutlineOutlined';
import StraightenOutlinedIcon     from '@mui/icons-material/StraightenOutlined';
import ImageOutlinedIcon          from '@mui/icons-material/ImageOutlined';
import UploadFileOutlinedIcon     from '@mui/icons-material/UploadFileOutlined';
import TravelExploreOutlinedIcon  from '@mui/icons-material/TravelExploreOutlined';
import InterestsOutlinedIcon      from '@mui/icons-material/InterestsOutlined';

import DragIndicatorIcon         from '@mui/icons-material/DragIndicator';
import { DndContext, closestCenter, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy, arrayMove } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

import { StudioProject } from '@repo/api';

import ButtonIcon from '@widgets/core/ButtonIcon';
import ButtonIconDropdown from '@widgets/core/ButtonIconDropdown';
import Pusher from '@widgets/core/Pusher';
import AudioWaveform from '@widgets/media/AudioWaveform';

//
// StudioTimeline — the multi-track TIMELINE region of the video editor. Tracks are horizontal lanes; clips are
// blocks positioned by absolute start × pxPerSec. You click a clip to select it, drag its body to reposition
// (and across tracks), drag either edge handle to trim/resize, click a lane (or scrub the ruler) to move the
// playhead, and zoom with the slider. It's a controlled component — it owns only transient drag state and
// reports every change up via callbacks (the editor owns the doc + autosave).
//
export function StudioTimeline( props : StudioTimeline.Props ) : JSX.Element
{
    const theme : Theme = useTheme();
    const contentRef = React.useRef< HTMLDivElement | null >( null );   // the scrolled content (time-space origin)
    const drag       = React.useRef< StudioTimeline.Drag | null >( null );
    const scrubbing  = React.useRef< boolean >( false );                // dragging the playhead handle
    const live       = React.useRef< StudioTimeline.Props >( props );   // latest props for the window listeners
    live.current = props;

    const doc : StudioProject.VideoDoc = props.doc;
    const tracks : Array<StudioProject.TimelineTrack> = doc.tracks ?? [];

    // the "Add" dropdown: "plain" → blank text, "solid" → a color card, any other value → a text template id
    function onAddTextChoice( value : string ) : void
    {
        if( value === StudioTimeline.PLAIN_TEXT ) props.onAddText();
        else if( value === StudioTimeline.SOLID_VALUE ) props.onAddSolid();
        else if( value === StudioTimeline.SHAPE_VALUE ) props.onAddShape();
        else props.onAddTemplate( value );
    }
    const clips : Array<StudioProject.TimelineClip> = doc.clips ?? [];
    const pxPerSec : number = props.pxPerSec;

    // pad the content past the last clip so you can drag/extend beyond the current end
    const totalSec : number = StudioProject.timelineDurationSec( doc );
    const contentSec : number = Math.max( totalSec + 4, 10 );
    const contentWidth : number = contentSec * pxPerSec;

    ////////////////////////////////////////////////////////////////////////////////////////////
    // window-level drag: register once, read live props/refs so the math never goes stale
    React.useEffect( () : ( () => void ) =>
    {
        window.addEventListener( "pointermove", onPointerMove );
        window.addEventListener( "pointerup", onPointerUp );
        return () : void =>
        {
            window.removeEventListener( "pointermove", onPointerMove );
            window.removeEventListener( "pointerup", onPointerUp );
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [] );

    // snap a second value to the timeline grid
    function snap( seconds : number ) : number { return Math.round( seconds / StudioTimeline.GRID_SEC ) * StudioTimeline.GRID_SEC; }

    // snap a dragged EDGE (in seconds) to the nearest magnetic target — other clips' start/end (any track,
    // excluding the dragged clip), the playhead, and 0 — within a PIXEL threshold; else fall back to the grid.
    // Returns whether it locked onto a real target + how far, so a MOVE can pick the closer of its two edges.
    function snapEdge( seconds : number, active : StudioTimeline.Drag, current : StudioTimeline.Props ) : { value : number; delta : number; snapped : boolean }
    {
        const threshold : number = StudioTimeline.SNAP_PX / current.pxPerSec;
        const targets : Array<number> = [ 0, Math.max( 0, current.currentSec ) ];
        for( const clip of current.doc.clips ?? [] )
        {
            if( clip.id === active.clipId ) continue;   // don't snap a clip to itself
            targets.push( clip.startSec );
            targets.push( clip.startSec + clip.durationSec );
        }
        let best : number | null = null;
        let bestDelta : number = threshold;
        for( const target of targets )
        {
            const delta : number = Math.abs( target - seconds );
            if( delta <= bestDelta ) { bestDelta = delta; best = target; }
        }
        return best !== null ? { value: best, delta: bestDelta, snapped: true } : { value: snap( seconds ), delta: 0, snapped: false };
    }

    // apply the active drag as the pointer moves (moves/resizes commit live so the preview tracks the drag)
    function onPointerMove( event : PointerEvent ) : void
    {
        // scrubbing the playhead handle takes priority — seek to the pointer's time position
        if( scrubbing.current ) { seekToClientX( event.clientX ); return; }
        const active : StudioTimeline.Drag | null = drag.current;
        if( active === null ) return;
        const current : StudioTimeline.Props = live.current;
        const deltaSec : number = ( event.clientX - active.startX ) / current.pxPerSec;

        // MOVE: reposition on the timeline + hop to the track under the pointer
        if( active.mode === StudioTimeline.DragMode.MOVE )
        {
            // snap either the clip's START or its END to a magnetic target — pick whichever locked on closer
            const rawStart : number = Math.max( 0, active.origStart + deltaSec );
            const startSnap : { value : number; delta : number; snapped : boolean } = snapEdge( rawStart, active, current );
            const endSnap : { value : number; delta : number; snapped : boolean } = snapEdge( rawStart + active.origDuration, active, current );
            let startSec : number = startSnap.value;
            if( endSnap.snapped && ( !startSnap.snapped || endSnap.delta < startSnap.delta ) ) startSec = endSnap.value - active.origDuration;
            startSec = Math.max( 0, startSec );
            const laneTracks : Array<StudioProject.TimelineTrack> = current.doc.tracks ?? [];
            const bounds : DOMRect | undefined = contentRef.current?.getBoundingClientRect();
            const laneY : number = bounds ? event.clientY - bounds.top - StudioTimeline.RULER_HEIGHT : 0;
            const index : number = Math.min( laneTracks.length - 1, Math.max( 0, Math.floor( laneY / StudioTimeline.LANE_HEIGHT ) ) );
            const trackId : string = laneTracks.length > 0 ? laneTracks[ index ].id : active.trackId;
            // remember the raw (snapped, pre-overlap-clamp) target so pointer-up can decide whether the drop
            // position was occupied (→ auto-add a track). The live move still commits a non-overlapping clamp.
            active.dropStart = startSec;
            active.dropTrackId = trackId;
            current.onMoveClip( active.clipId, startSec, trackId );
            return;
        }

        // RESIZE-RIGHT: change duration only (out-point). Time-based media (known source length) can be trimmed
        // SHORTER but never stretched past what remains of the source from the in-point.
        if( active.mode === StudioTimeline.DragMode.RESIZE_RIGHT )
        {
            // snap the OUT edge to a magnetic target, then derive the duration (grid fallback inside snapEdge)
            const endSnap : { value : number } = snapEdge( active.origStart + Math.max( StudioTimeline.GRID_SEC, active.origDuration + deltaSec ), active, current );
            let durationSec : number = Math.max( StudioTimeline.GRID_SEC, endSnap.value - active.origStart );
            if( active.sourceDuration !== undefined ) durationSec = Math.min( durationSec, Math.max( StudioTimeline.GRID_SEC, active.sourceDuration - active.origTrim ) );
            current.onResizeClip( active.clipId, active.origStart, durationSec, active.origTrim );
            return;
        }

        // RESIZE-LEFT: move the in-point → shifts start + trims the head, keeping the out-point fixed
        let shift : number = deltaSec;
        // snap the IN edge to a magnetic target (grid fallback), then re-derive the shift
        const startSnap : { value : number } = snapEdge( active.origStart + shift, active, current );
        shift = startSnap.value - active.origStart;
        if( active.origStart + shift < 0 ) shift = -active.origStart;
        if( active.origTrim + shift < 0 ) shift = -active.origTrim;
        if( active.origDuration - shift < StudioTimeline.GRID_SEC ) shift = active.origDuration - StudioTimeline.GRID_SEC;
        current.onResizeClip( active.clipId, active.origStart + shift, active.origDuration - shift, active.origTrim + shift );
    }

    // end the drag/scrub (the change has already been committed live). For a MOVE, report the final drop so the
    // editor can relocate to a new track when the dropped-on position was occupied (no room).
    function onPointerUp() : void
    {
        const active : StudioTimeline.Drag | null = drag.current;
        const current : StudioTimeline.Props = live.current;
        if( active !== null && active.mode === StudioTimeline.DragMode.MOVE && active.dropTrackId !== undefined && current.onDropClip )
            current.onDropClip( active.clipId, active.dropStart ?? active.origStart, active.dropTrackId );
        drag.current = null;
        scrubbing.current = false;
    }

    // begin dragging the playhead handle — scrub while the pointer moves (see onPointerMove)
    function beginScrub( event : React.PointerEvent ) : void
    {
        event.stopPropagation();
        scrubbing.current = true;
        seekToClientX( event.clientX );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // begin dragging a clip (body = move, edges = resize); selects the clip
    function beginDrag( event : React.PointerEvent, clip : StudioProject.TimelineClip, mode : StudioTimeline.DragMode ) : void
    {
        if( props.readonly ) return;
        event.stopPropagation();
        // Shift/⌘-click toggles the clip in the multi-selection instead of starting a drag
        if( event.shiftKey || event.metaKey || event.ctrlKey ) { props.onToggleSelect( clip.id ); return; }
        props.onSelectClip( clip.id );
        drag.current = { clipId: clip.id, mode, trackId: clip.trackId, startX: event.clientX, origStart: clip.startSec, origDuration: clip.durationSec, origTrim: clip.trimStartSec ?? 0, sourceDuration: clip.sourceDurationSec };
    }

    // seek to the pointer's time position from an x coordinate in content space
    function seekToClientX( clientX : number ) : void
    {
        const bounds : DOMRect | undefined = contentRef.current?.getBoundingClientRect();
        if( bounds === undefined ) return;
        props.onSeek( Math.max( 0, ( clientX - bounds.left ) / pxPerSec ) );
    }

    // scrub via the ruler
    function onRulerDown( event : React.PointerEvent ) : void { seekToClientX( event.clientX ); }

    // click empty lane space → seek there + deselect
    function onLanesDown( event : React.PointerEvent ) : void
    {
        if( drag.current !== null ) return;
        seekToClientX( event.clientX );
        props.onSelectClip( null );
    }

    // change the zoom (px per second)
    function onZoomChange( _event : Event, value : number | Array<number> ) : void
    {
        props.onZoom( Array.isArray( value ) ? value[ 0 ] : value );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // the palette group tinting a clip by kind
    function clipGroup( kind : StudioProject.VideoSceneKind ) : StudioTimeline.PaletteGroup
    {
        if( kind === StudioProject.VideoSceneKind.VIDEO ) return "primary";
        if( kind === StudioProject.VideoSceneKind.TEXT )  return "secondary";
        if( kind === StudioProject.VideoSceneKind.AUDIO ) return "success";
        return "info";
    }

    // a readable label for a clip
    function clipLabel( clip : StudioProject.TimelineClip ) : string
    {
        if( clip.kind === StudioProject.VideoSceneKind.TEXT ) return clip.text && clip.text.trim() !== "" ? clip.text : "Text";
        return clip.name && clip.name.trim() !== "" ? clip.name : clip.kind;
    }

    // ruler tick step (seconds) — coarser when zoomed out so labels stay legible
    function tickStep() : number
    {
        if( pxPerSec < 16 ) return 5;
        if( pxPerSec < 45 ) return 2;
        return 1;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // one clip block on a lane
    function clipBlock( clip : StudioProject.TimelineClip ) : JSX.Element
    {
        const group : StudioTimeline.PaletteGroup = clipGroup( clip.kind );
        const selected : boolean = props.selectedClipIds.includes( clip.id );
        return  <Box key={ clip.id }
                     onPointerDown={ ( event : React.PointerEvent ) : void => beginDrag( event, clip, StudioTimeline.DragMode.MOVE ) }
                     sx={{
                         position: "absolute", top: 4, height: StudioTimeline.LANE_HEIGHT - 8,
                         left: clip.startSec * pxPerSec, width: Math.max( 8, clip.durationSec * pxPerSec ),
                         bgcolor: ( styled : Theme ) : string => alpha( styled.palette[ group ].main, selected ? 0.55 : 0.32 ),
                         border: 1, borderColor: selected ? `${ group }.main` : "divider", borderRadius: 1,
                         cursor: props.readonly ? "default" : "grab", overflow: "hidden",
                         display: "flex", alignItems: "center", px: 1, boxSizing: "border-box",
                     }}>
                    {/* audio AND video clips show a static waveform of their (trimmed) source behind the label —
                        a video's audio track decodes from the same source file, so an editor sees its levels */}
                    { ( clip.kind === StudioProject.VideoSceneKind.AUDIO || clip.kind === StudioProject.VideoSceneKind.VIDEO ) && clip.src &&
                        <Box sx={{ position: "absolute", inset: 0, opacity: 0.55, pointerEvents: "none" }}>
                            <AudioWaveform src={ clip.src } cacheKey={ clip.assetGuid ?? clip.id }
                                           width={ Math.max( 8, clip.durationSec * pxPerSec ) } height={ StudioTimeline.LANE_HEIGHT - 8 }
                                           color={ theme.palette[ group ].main }
                                           startSec={ clip.trimStartSec } windowSec={ clip.durationSec } />
                        </Box> }
                    { !props.readonly &&
                        <Box onPointerDown={ ( event : React.PointerEvent ) : void => beginDrag( event, clip, StudioTimeline.DragMode.RESIZE_LEFT ) }
                             sx={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 6, cursor: "ew-resize", bgcolor: `${ group }.main`, opacity: 0.5 }} /> }
                    <Typography variant="caption" noWrap sx={{ color: "text.primary", fontWeight: 600, pointerEvents: "none" }}>{ clipLabel( clip ) }</Typography>
                    { !props.readonly &&
                        <Box onPointerDown={ ( event : React.PointerEvent ) : void => beginDrag( event, clip, StudioTimeline.DragMode.RESIZE_RIGHT ) }
                             sx={{ position: "absolute", right: 0, top: 0, bottom: 0, width: 6, cursor: "ew-resize", bgcolor: `${ group }.main`, opacity: 0.5 }} /> }
                </Box>;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // drag-to-reorder tracks: move the dragged track id to the drop position (array order = paint z-order)
    function onTracksDragEnd( event : DragEndEvent ) : void
    {
        const ids : Array<string> = tracks.map( ( track : StudioProject.TimelineTrack ) : string => track.id );
        const from : number = ids.indexOf( String( event.active.id ) );
        const to : number = event.over ? ids.indexOf( String( event.over.id ) ) : -1;
        if( from < 0 || to < 0 || from === to ) return;
        props.onReorderTracks( arrayMove( ids, from, to ) );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // one track's lane (its clips, positioned in time)
    function laneRow( track : StudioProject.TimelineTrack ) : JSX.Element
    {
        const laneClips : Array<StudioProject.TimelineClip> = clips.filter( ( clip : StudioProject.TimelineClip ) : boolean => clip.trackId === track.id );
        return  <Box key={ track.id } sx={{ position: "relative", height: StudioTimeline.LANE_HEIGHT, borderBottom: 1, borderColor: "divider", opacity: track.hidden ? 0.4 : 1 }}>
                    { laneClips.map( ( clip : StudioProject.TimelineClip ) : JSX.Element => clipBlock( clip ) ) }
                </Box>;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // the ruler tick marks + labels
    function rulerTicks() : Array<JSX.Element>
    {
        const step : number = tickStep();
        const ticks : Array<JSX.Element> = [];
        for( let second : number = 0; second <= contentSec; second += step )
            ticks.push( <Box key={ second } sx={{ position: "absolute", left: second * pxPerSec, top: 0, bottom: 0, borderLeft: 1, borderColor: "divider", pl: 0.5, display: "flex", alignItems: "center" }}>
                            <Typography variant="caption" sx={{ color: "text.secondary", fontSize: 12 }}>{ `${ second }s` }</Typography>
                        </Box> );
        return ticks;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    return  <Box sx={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>

                {/* header — clip/track actions on the LEFT, the zoom (timescale) slider all the way RIGHT */}
                <Stack direction="row" spacing={ 1 } sx={{ alignItems: "center", px: 1, py: 0.25, borderBottom: 1, borderColor: "divider", flexShrink: 0 }}>
                    {/* 1 — track structure */}
                    <ButtonIcon id="tl-add-track"
                                label={"Add track"}
                                size="small"
                                disabled={ props.readonly }
                                icon={ <AddOutlinedIcon fontSize="small" /> }
                                onClick={ props.onAddTrack } />
                    <Divider orientation="vertical" flexItem />
                    {/* 2 — imports / insert content */}
                    <ButtonIcon id="tl-add-library"   label={"Add from Library"}   size="small" disabled={ props.readonly } icon={ <ImageOutlinedIcon fontSize="small" /> }         onClick={ props.onAddLibrary } />
                    <ButtonIcon id="tl-import-audio"  label={"Import Audio"}       size="small" disabled={ props.readonly } icon={ <UploadFileOutlinedIcon fontSize="small" /> }    onClick={ props.onImportAudio } />
                    <ButtonIcon id="tl-add-providers" label={"Add from Providers"} size="small" disabled={ props.readonly } icon={ <TravelExploreOutlinedIcon fontSize="small" /> } onClick={ props.onAddProviders } />
                    <ButtonIconDropdown id="tl-add-text"
                                label={"Add text"}
                                size="small"
                                disabled={ props.readonly }
                                icon={ <TitleOutlinedIcon fontSize="small" /> }
                                choices={ StudioTimeline.ADD_TEXT_CHOICES }
                                onChange={ onAddTextChoice } />
                    <ButtonIconDropdown id="tl-add-geometry"
                                label={"Add shape / solid"}
                                size="small"
                                disabled={ props.readonly }
                                icon={ <InterestsOutlinedIcon fontSize="small" /> }
                                choices={ StudioTimeline.ADD_GEOMETRY_CHOICES }
                                onChange={ onAddTextChoice } />
                    <Divider orientation="vertical" flexItem />
                    {/* 3 — edit tools */}
                    <ButtonIcon id="tl-split"
                                label={"Split at playhead"}
                                size="small"
                                disabled={ props.readonly || !props.canSplit }
                                icon={ <ContentCutOutlinedIcon fontSize="small" /> }
                                onClick={ props.onSplit } />
                    <ButtonIcon id="tl-duplicate"
                                label={"Duplicate clip"}
                                size="small"
                                disabled={ props.readonly || !props.canDuplicate }
                                icon={ <ContentCopyOutlinedIcon fontSize="small" /> }
                                onClick={ props.onDuplicate } />
                    <ButtonIcon id="tl-undo"
                                label={"Undo"}
                                size="small"
                                disabled={ props.readonly || !props.canUndo }
                                icon={ <UndoOutlinedIcon fontSize="small" /> }
                                onClick={ props.onUndo } />
                    <ButtonIcon id="tl-redo"
                                label={"Redo"}
                                size="small"
                                disabled={ props.readonly || !props.canRedo }
                                icon={ <RedoOutlinedIcon fontSize="small" /> }
                                onClick={ props.onRedo } />
                    <Pusher />
                    {/* zoom / stretch the timeline (px per second) */}
                    <StraightenOutlinedIcon fontSize="small" sx={{ color: "text.secondary" }} />
                    <Box sx={{ width: 140, pr: 3 }}>
                        <Slider min={ StudioTimeline.MIN_PX_PER_SEC }
                                max={ StudioTimeline.MAX_PX_PER_SEC }
                                //sx={ { mr : 5 } }
                                value={ pxPerSec }
                                onChange={ onZoomChange }
                                aria-label={"Zoom"} />
                    </Box>
                </Stack>

                {/* body — fixed gutter + horizontally-scrolling lanes */}
                <Box sx={{ display: "flex", flexGrow: 1, minHeight: 0, overflowY: "auto" }}>
                    <Box sx={{ width: StudioTimeline.GUTTER_WIDTH, flexShrink: 0, borderRight: 1, borderColor: "divider" }}>
                        <Box sx={{ height: StudioTimeline.RULER_HEIGHT, borderBottom: 1, borderColor: "divider", bgcolor: "background.paper" }} />
                        {/* drag the handle to reorder tracks in the z-stack (or use the ↑/↓ arrows) */}
                        <DndContext collisionDetection={ closestCenter } onDragEnd={ onTracksDragEnd }>
                            <SortableContext items={ tracks.map( ( track : StudioProject.TimelineTrack ) : string => track.id ) } strategy={ verticalListSortingStrategy }>
                                { tracks.map( ( track : StudioProject.TimelineTrack ) : JSX.Element =>
                                    <TrackGutterRow key={ track.id } track={ track } trackCount={ tracks.length } readonly={ props.readonly === true }
                                                    onToggleMuted={ props.onToggleMuted } onToggleHidden={ props.onToggleHidden } onRemoveTrack={ props.onRemoveTrack } /> ) }
                            </SortableContext>
                        </DndContext>
                    </Box>
                    <Box sx={{ flexGrow: 1, overflowX: "auto" }}>
                        <Box ref={ contentRef } sx={{ position: "relative", width: contentWidth, minWidth: "100%" }}>
                            <Box onPointerDown={ onRulerDown } sx={{ position: "relative", height: StudioTimeline.RULER_HEIGHT, borderBottom: 1, borderColor: "divider", bgcolor: "background.paper", cursor: "text" }}>
                                { rulerTicks() }
                            </Box>
                            <Box onPointerDown={ onLanesDown }>
                                { tracks.map( ( track : StudioProject.TimelineTrack ) : JSX.Element => laneRow( track ) ) }
                            </Box>
                            {/* playhead — the vertical line plus a grabbable handle at the top for easier scrubbing */}
                            <Box sx={{ position: "absolute", top: 0, bottom: 0, left: props.currentSec * pxPerSec, width: "2px", bgcolor: "error.main", pointerEvents: "none", zIndex: 2 }}>
                                <Box
                                    onPointerDown={ beginScrub }
                                    sx={{
                                        position: "absolute", top: -2, left: "1px", transform: "translateX( -50% )",
                                        width: 14, height: 14, borderRadius: "3px", bgcolor: "error.main",
                                        cursor: "ew-resize", pointerEvents: "auto", zIndex: 3,
                                        boxShadow: 1,
                                    }} />
                            </Box>
                        </Box>
                    </Box>
                </Box>
            </Box>;
}

//
// TrackGutterRow — one sortable track row in the timeline gutter: a drag handle (reorders the z-stack via
// @dnd-kit), the track name, and its ↑/↓ reorder · mute · hide · remove controls (the arrows remain a
// keyboard-free fallback to dragging). A small presentation-only companion to StudioTimeline.
//
function TrackGutterRow( props : StudioTimeline.TrackGutterRowProps ) : JSX.Element
{
    const track : StudioProject.TimelineTrack = props.track;
    const sortable : ReturnType<typeof useSortable> = useSortable( { id: track.id, disabled: props.readonly } );
    const style : React.CSSProperties = { transform: CSS.Transform.toString( sortable.transform ), transition: sortable.transition };

    return  <Stack ref={ sortable.setNodeRef } style={ style } direction="row" spacing={ 0.5 }
                   sx={{ height: StudioTimeline.LANE_HEIGHT, alignItems: "center", px: 1, borderBottom: 1, borderColor: "divider", bgcolor: "background.paper" }}>
                <Box { ...sortable.attributes } { ...sortable.listeners } sx={{ display: "flex", cursor: props.readonly ? "default" : "grab", color: "text.disabled", touchAction: "none" }}>
                    <DragIndicatorIcon fontSize="small" />
                </Box>
                <Typography variant="caption" noWrap sx={{ flexGrow: 1, minWidth: 0, color: "text.secondary" }}>{ track.name }</Typography>
                <ButtonIcon id={ `${ track.id }-mute` } label={ track.muted ? "Unmute track" : "Mute track" } size="small" disabled={ props.readonly }
                            icon={ track.muted ? <VolumeOffOutlinedIcon fontSize="small" /> : <VolumeUpOutlinedIcon fontSize="small" /> } onClick={ () : void => props.onToggleMuted( track.id ) } />
                <ButtonIcon id={ `${ track.id }-hide` } label={ track.hidden ? "Show track" : "Hide track" } size="small" disabled={ props.readonly }
                            icon={ track.hidden ? <VisibilityOffOutlinedIcon fontSize="small" /> : <VisibilityOutlinedIcon fontSize="small" /> } onClick={ () : void => props.onToggleHidden( track.id ) } />
                <ButtonIcon id={ `${ track.id }-rm` } label={"Remove track"} size="small" disabled={ props.readonly || props.trackCount <= 1 }
                            icon={ <DeleteOutlineOutlinedIcon fontSize="small" /> } onClick={ () : void => props.onRemoveTrack( track.id ) } />
            </Stack>;
}

export namespace StudioTimeline
{
    export const LANE_HEIGHT : number = 44;
    export const RULER_HEIGHT : number = 38;
    export const GUTTER_WIDTH : number = 200;   // drag handle + track name (roomy) + mute / hide / remove (reorder is drag)
    export const MIN_PX_PER_SEC : number = 10;
    export const MAX_PX_PER_SEC : number = 200;
    export const GRID_SEC : number = 0.1;   // snap resolution
    export const SNAP_PX : number = 8;       // magnetic snap radius (px) to clip edges / playhead during a drag

    /** Props for the sortable {@link TrackGutterRow} — the track + its index/count + the row's callbacks. */
    export interface TrackGutterRowProps
    {
        track          : StudioProject.TimelineTrack;
        trackCount     : number;
        readonly       : boolean;
        onToggleMuted  : ( id : string ) => void;
        onToggleHidden : ( id : string ) => void;
        onRemoveTrack  : ( id : string ) => void;
    }

    /** The "Add" dropdown value for a plain (blank) text clip; other values are {@link StudioProject.TextTemplate} ids. */
    export const PLAIN_TEXT : string = "plain";
    /** The "Add" dropdown value for a solid color card. */
    export const SOLID_VALUE : string = "solid";
    /** The "Add" dropdown value for an SVG shape/graphic overlay. */
    export const SHAPE_VALUE : string = "shape";

    /** The TEXT "Add" dropdown choices: a blank text clip, then each built-in template. */
    export const ADD_TEXT_CHOICES : Array<ButtonIconDropdown.Choice> =
    [
        { value: PLAIN_TEXT, label: "Plain text" },
        ...StudioProject.TEXT_TEMPLATES.map( ( entry : StudioProject.TextTemplateDef ) : ButtonIconDropdown.Choice => ( { value: entry.template, label: entry.label } ) ),
    ];

    /** The GEOMETRY "Add" dropdown choices: a solid color card + an SVG shape / graphic. */
    export const ADD_GEOMETRY_CHOICES : Array<ButtonIconDropdown.Choice> =
    [
        { value: SOLID_VALUE, label: "Solid color" },
        { value: SHAPE_VALUE, label: "Shape / graphic" },
    ];

    /** A palette group used to tint clips by kind. */
    export type PaletteGroup = "primary" | "secondary" | "info" | "success";

    /** What a pointer drag is doing to a clip. */
    export enum DragMode { MOVE = "move", RESIZE_LEFT = "resize-l", RESIZE_RIGHT = "resize-r" }

    /** The transient state of an in-progress clip drag (captured at pointer-down). */
    export interface Drag
    {
        clipId       : string;
        mode         : DragMode;
        trackId      : string;
        startX       : number;
        origStart    : number;
        origDuration : number;
        origTrim     : number;
        sourceDuration? : number;   // the source's natural length (video/audio) — caps how far the clip can extend
        dropStart?   : number;      // the last raw (snapped) target start of a MOVE — reported on drop
        dropTrackId? : string;      // the last hovered track id of a MOVE — reported on drop
    }

    export interface Props
    {
        doc            : StudioProject.VideoDoc;
        pxPerSec       : number;
        currentSec     : number;
        selectedClipId : string | null;
        selectedClipIds : Array<string>;   // full multi-selection (for highlight)
        readonly       : boolean;
        canSplit       : boolean;               // the selected clip can be split at the current playhead
        canDuplicate   : boolean;               // a clip is selected (can be duplicated)
        canUndo        : boolean;
        canRedo        : boolean;
        onSelectClip   : ( id : string | null ) => void;
        onToggleSelect : ( id : string ) => void;   // Shift/⌘-click: add/remove from the multi-selection
        onAddLibrary   : () => void;
        onImportAudio  : () => void;
        onAddProviders : () => void;
        onAddText      : () => void;
        onAddTemplate  : ( template : string ) => void;
        onAddSolid     : () => void;
        onAddShape     : () => void;
        onSplit        : () => void;
        onDuplicate    : () => void;
        onUndo         : () => void;
        onRedo         : () => void;
        onMoveClip     : ( id : string, startSec : number, trackId : string ) => void;
        onDropClip?    : ( id : string, startSec : number, trackId : string ) => void;   // MOVE drop: relocate to a new track when the drop position was occupied
        onResizeClip   : ( id : string, startSec : number, durationSec : number, trimStartSec : number ) => void;
        onSeek         : ( sec : number ) => void;
        onZoom         : ( pxPerSec : number ) => void;
        onAddTrack     : () => void;
        onReorderTracks : ( orderedIds : Array<string> ) => void;   // drag-to-reorder result (full new order)
        onToggleMuted  : ( id : string ) => void;
        onToggleHidden : ( id : string ) => void;
        onRemoveTrack  : ( id : string ) => void;
    }
}

export default StudioTimeline;
// eof
