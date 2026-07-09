import React from 'react';
import { JSX } from "react";

//
// AudioWaveform — a static, precomputed waveform for an audio source, drawn on a <canvas>. It fetches + decodes
// the audio ONCE per `cacheKey` (the durable asset guid), downsamples to a fixed set of peaks, and caches them
// module-wide so re-renders / remounts (timeline scroll, zoom) never re-decode. The visible slice can be scoped
// to a source window (`startSec`/`windowSec`) so a trimmed clip shows only its portion. Purely presentational.
//
export function AudioWaveform( props : AudioWaveform.Props ) : JSX.Element
{
    const canvasRef = React.useRef< HTMLCanvasElement | null >( null );
    const [ peaks, setPeaks ] = React.useState< AudioWaveform.Peaks | null >( () => AudioWaveform.CACHE.get( props.cacheKey ) ?? null );

    ////////////////////////////////////////////////////////////////////////////////////////////
    // decode + cache the peaks when the source/key changes (cached → instant)
    React.useEffect( () : void => { void loadPeaks(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [ props.cacheKey, props.src ] );

    async function loadPeaks() : Promise<void>
    {
        const cached : AudioWaveform.Peaks | undefined = AudioWaveform.CACHE.get( props.cacheKey );
        if( cached !== undefined ) { setPeaks( cached ); return; }
        try
        {
            // fetch the bytes and decode to PCM, then reduce channel 0 to a fixed peak profile (max |sample| per bucket)
            const response : Response = await fetch( props.src );
            const buffer : ArrayBuffer = await response.arrayBuffer();
            const decoded : AudioBuffer = await AudioWaveform.audioContext().decodeAudioData( buffer );
            const samples : Float32Array = decoded.getChannelData( 0 );
            const values : Array<number> = downsample( samples, AudioWaveform.RESOLUTION );
            const result : AudioWaveform.Peaks = { values, durationSec: decoded.duration };
            AudioWaveform.CACHE.set( props.cacheKey, result );
            setPeaks( result );
        }
        catch { /* CORS / unsupported codec → leave blank (no waveform) */ }
    }

    // reduce a PCM channel to `buckets` peaks (max absolute amplitude per bucket)
    function downsample( samples : Float32Array, buckets : number ) : Array<number>
    {
        const out : Array<number> = new Array<number>( buckets ).fill( 0 );
        const size : number = Math.max( 1, Math.floor( samples.length / buckets ) );
        for( let index : number = 0; index < buckets; index++ )
        {
            let max : number = 0;
            const start : number = index * size;
            for( let offset : number = 0; offset < size; offset++ )
            {
                const value : number = Math.abs( samples[ start + offset ] ?? 0 );
                if( value > max ) max = value;
            }
            out[ index ] = max;
        }
        return out;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // (re)draw whenever the peaks or the geometry/window change
    React.useEffect( () : void => { draw(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [ peaks, props.width, props.height, props.color, props.startSec, props.windowSec ] );

    // paint the visible window of the peak profile as center-mirrored vertical bars
    function draw() : void
    {
        const canvas : HTMLCanvasElement | null = canvasRef.current;
        if( canvas === null || peaks === null || props.width <= 0 ) return;
        const ratio : number = window.devicePixelRatio || 1;
        canvas.width = Math.max( 1, Math.floor( props.width * ratio ) );
        canvas.height = Math.max( 1, Math.floor( props.height * ratio ) );
        const context : CanvasRenderingContext2D | null = canvas.getContext( "2d" );
        if( context === null ) return;
        context.scale( ratio, ratio );
        context.clearRect( 0, 0, props.width, props.height );
        context.fillStyle = props.color;

        // the fraction of the source this clip shows (trim in-point → in-point + duration)
        const duration : number = peaks.durationSec > 0 ? peaks.durationSec : 1;
        const startFraction : number = Math.max( 0, Math.min( 1, ( props.startSec ?? 0 ) / duration ) );
        const endFraction : number = Math.max( startFraction, Math.min( 1, ( ( props.startSec ?? 0 ) + ( props.windowSec ?? duration ) ) / duration ) );

        const middle : number = props.height / 2;
        const columns : number = Math.max( 1, Math.floor( props.width ) );
        for( let x : number = 0; x < columns; x++ )
        {
            const fraction : number = startFraction + ( endFraction - startFraction ) * ( x / columns );
            const index : number = Math.min( peaks.values.length - 1, Math.floor( fraction * peaks.values.length ) );
            const barHeight : number = Math.max( 1, ( peaks.values[ index ] ?? 0 ) * props.height );
            context.fillRect( x, middle - barHeight / 2, 1, barHeight );
        }
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    return <canvas ref={ canvasRef } style={{ width: props.width, height: props.height, display: "block" }} />;
}

export namespace AudioWaveform
{
    export const RESOLUTION : number = 1024;   // stored peaks per asset (redraws downsample from these)

    /** A decoded asset's peak profile (module-cached by asset guid). */
    export interface Peaks { values : Array<number>; durationSec : number; }

    /** Module-wide peak cache — decode once per asset, reuse across timeline re-renders / remounts. */
    export const CACHE : Map<string, Peaks> = new Map<string, Peaks>();

    // a lazily-created shared AudioContext for decoding (decodeAudioData works without a user gesture)
    let context : AudioContext | null = null;
    export function audioContext() : AudioContext
    {
        if( context === null ) context = new AudioContext();
        return context;
    }

    export interface Props
    {
        src        : string;   // delivery URL of the audio (must be CORS-fetchable to decode)
        cacheKey   : string;   // stable key for the peak cache (the asset guid)
        width      : number;   // CSS px
        height     : number;   // CSS px
        color      : string;   // resolved CSS color for the bars
        startSec?  : number;   // source in-point (trim) — start of the visible window
        windowSec? : number;   // visible span of the source (the clip's duration)
    }
}

export default AudioWaveform;
// eof
