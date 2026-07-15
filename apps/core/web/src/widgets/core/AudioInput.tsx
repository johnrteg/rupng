//
import React from 'react';
import { JSX } from "react";

import { Box, IconButton, Slider, Stack, Typography } from "@mui/material";
import PlayArrowRoundedIcon  from '@mui/icons-material/PlayArrowRounded';
import PauseRoundedIcon      from '@mui/icons-material/PauseRounded';
import VolumeUpRoundedIcon   from '@mui/icons-material/VolumeUpRounded';
import VolumeOffRoundedIcon  from '@mui/icons-material/VolumeOffRounded';

//
// AudioInput — a themed audio player (the audio counterpart to ImageInput / VideoInput). Plays an audio file
// with a play/pause control, a seek slider, and the time PLAYED at the start + the TOTAL time at the end, both
// MM:SS. Colors come from the theme (no hard-coded values) so it flips with dark mode. The parent supplies the
// source URL; this widget owns its own playback state.
//
export function AudioInput( props : AudioInput.Props ) : JSX.Element
{
    const audioRef : React.RefObject<HTMLAudioElement | null> = React.useRef<HTMLAudioElement>( null );

    const [playing,setPlaying]     = React.useState< boolean >( false );
    const [current,setCurrent]     = React.useState< number >( 0 );
    const [duration,setDuration]   = React.useState< number >( 0 );
    const [volume,setVolume]       = React.useState< number >( 1 );   // 0..1

    ////////////////////////////////////////////////////////////////////////////////////////////
    // slightly thicker slider rail/track/thumb than MUI's small default (rail 2px → 4px)
    const sliderSx = {
        py: 0,
        "& .MuiSlider-rail, & .MuiSlider-track": { height: 4 },
        "& .MuiSlider-thumb": { width: 12, height: 12 },
    } as const;

    ////////////////////////////////////////////////////////////////////////////////////////////
    // reset playback state whenever the source changes (a reused player must not keep the old position)
    React.useEffect( () : void => { setPlaying( false ); setCurrent( 0 ); setDuration( 0 ); }, [ props.value ] );

    ////////////////////////////////////////////////////////////////////////////////////////////
    // format a seconds count as MM:SS (a NaN/negative duration shows 0:00)
    function formatTime( seconds : number ) : string
    {
        const safe : number = Number.isFinite( seconds ) && seconds > 0 ? seconds : 0;
        const minutes : number = Math.floor( safe / 60 );
        const remainder : number = Math.floor( safe % 60 );
        return `${ minutes }:${ String( remainder ).padStart( 2, "0" ) }`;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // toggle play/pause on the underlying <audio> element
    function togglePlay() : void
    {
        const element : HTMLAudioElement | null = audioRef.current;
        if( !element ) return;
        if( element.paused ) void element.play();
        else element.pause();
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // <audio> metadata loaded → capture the total duration
    function onLoadedMetadata() : void
    {
        if( audioRef.current ) setDuration( audioRef.current.duration );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // <audio> playback progressed → track the current position for the slider + played time
    function onTimeUpdate() : void
    {
        if( audioRef.current ) setCurrent( audioRef.current.currentTime );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // seek to the slider position (single or range value — take the first)
    function onSeek( _event : Event, value : number | Array<number> ) : void
    {
        const next : number = Array.isArray( value ) ? ( value[ 0 ] ?? 0 ) : value;
        if( audioRef.current ) audioRef.current.currentTime = next;
        setCurrent( next );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // set the playback volume (0..1) from the volume slider, applied to the underlying <audio>
    function onVolume( _event : Event, value : number | Array<number> ) : void
    {
        const next : number = Array.isArray( value ) ? ( value[ 0 ] ?? 0 ) : value;
        if( audioRef.current ) audioRef.current.volume = next;
        setVolume( next );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // mute/unmute: to 0 when audible, else back to full
    function toggleMute() : void
    {
        const next : number = volume > 0 ? 0 : 1;
        if( audioRef.current ) audioRef.current.volume = next;
        setVolume( next );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // a rounded pill row (like a native player): play/pause, a combined "played / total" time label, then the
    // progress track filling the remaining width. Everything vertically centered.
    return  <Stack direction="row" spacing={ 1 }
                   sx={{ alignItems: "center", width: props.width ?? 320, px: 1.5, py: 0.5,
                         bgcolor: "action.hover", borderRadius: 999, ...( props.sx ?? {} ) }}>
                <audio ref={ audioRef }
                       src={ props.value }
                       autoPlay={ props.autoPlay ?? false }
                       onPlay={ () : void => setPlaying( true ) }
                       onPause={ () : void => setPlaying( false ) }
                       onEnded={ () : void => setPlaying( false ) }
                       onLoadedMetadata={ onLoadedMetadata }
                       onTimeUpdate={ onTimeUpdate } />

                <IconButton size="small" onClick={ togglePlay } aria-label={ playing ? "Pause" : "Play" } sx={{ color: "text.primary", flexShrink: 0, p: 0.5 }}>
                    { playing ? <PauseRoundedIcon /> : <PlayArrowRoundedIcon /> }
                </IconButton>

                {/* combined "played / total" time label */}
                <Typography variant="caption" sx={{ color: "text.secondary", lineHeight: 1, fontVariantNumeric: "tabular-nums", flexShrink: 0, whiteSpace: "nowrap" }}>
                    { `${ formatTime( current ) } / ${ formatTime( duration ) }` }
                </Typography>

                <Box sx={{ flexGrow: 1, display: "flex", alignItems: "center", pl: 1, pr: 0.5 }}>
                    <Slider size="small" value={ current } min={ 0 } max={ duration > 0 ? duration : 0 } step={ 0.1 } onChange={ onSeek }
                            valueLabelDisplay="auto" valueLabelFormat={ ( value : number ) : string => formatTime( value ) }
                            aria-label="Seek" sx={ sliderSx } />
                </Box>

                {/* volume control on the right (opt-out via the `volume` prop) — the mute icon toggles mute,
                    and the level slider is shown alongside it whenever the control is open */}
                { props.volume !== false &&
                    <Box sx={{ display: "flex", alignItems: "center", flexShrink: 0 }}>
                        <IconButton size="small" onClick={ toggleMute } aria-label={ volume > 0 ? "Mute" : "Unmute" } sx={{ color: "text.secondary", p: 0.5 }}>
                            { volume > 0 ? <VolumeUpRoundedIcon fontSize="small" /> : <VolumeOffRoundedIcon fontSize="small" /> }
                        </IconButton>
                        <Box sx={{ width: 70, display: "flex", alignItems: "center", px: 1 }}>
                            <Slider size="small" value={ volume } min={ 0 } max={ 1 } step={ 0.05 } onChange={ onVolume } aria-label="Volume" sx={ sliderSx } />
                        </Box>
                    </Box> }
            </Stack>;
}

export namespace AudioInput
{
    export interface Props
    {
        id         : string;
        value      : string;              // the audio source URL
        autoPlay?  : boolean;
        volume?    : boolean;             // show the volume control (default true) — set false to hide it
        width?     : number | string;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        sx?        : any;
    }
}

export default AudioInput;
// eof
