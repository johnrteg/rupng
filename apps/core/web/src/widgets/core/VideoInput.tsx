//
import React from 'react';
import { JSX } from "react";

//

//

export function VideoInput( props: VideoInput.Props ) : JSX.Element
{
    const [url,setUrl]  = React.useState< string >( props.value );

    const videoRef = React.useRef<HTMLVideoElement>(null);

    React.useEffect( valueChanged, [props.value] );
    React.useEffect( seekRequested, [props.seekNonce] );

    ////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    function valueChanged() : void
    {
        if( props.value !== url )setUrl( props.value );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // an external caller (e.g. a transcript line editor) asked to seek — `seekNonce` bumps on EVERY request
    // (even to the same `seekTo`) so re-selecting the same line still seeks
    function seekRequested() : void
    {
        if( props.seekNonce === undefined || props.seekTo === undefined ) return;
        if( videoRef.current ) videoRef.current.currentTime = props.seekTo;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // report native playback position to the parent (e.g. to highlight the active transcript line)
    function onNativeTimeUpdate() : void
    {
        if( props.onTimeUpdate && videoRef.current ) props.onTimeUpdate( videoRef.current.currentTime );
    }

    //////////////////////////////////////////////////////////////////////////////////////////////////
    function onClick( evt : React.MouseEvent<HTMLVideoElement> ) : void
    {
        // if on click callback is given
        if( props.onClick )
        {
            // stop propagation
            evt.preventDefault(); 
            evt.stopPropagation();

            // if playing, pause it
            if( videoRef.current && !videoRef.current.paused )
            {
                videoRef.current.pause();
            }

            props.onClick();
        }
        
    }

    return <video
            ref={videoRef}
            key={ props.id + "::" + url }
            //src={ url }
            controls
            autoPlay={ props.autoPlay ? props.autoPlay : false }
            style={{
                maxWidth: props.maxWidth ?? 300,
                maxHeight: props.maxHeight ?? 300,
                width : props.width ?? "auto",
                borderRadius: 8,
                cursor: props.onClick ? "pointer" : undefined,
                ...(props.sx || {})
            }}
            onClick={ onClick }
            onTimeUpdate={ onNativeTimeUpdate }
        >
            <source src={ url } type={"video/mp4"} />
        </video>;  
}

export namespace VideoInput
{
    export interface Props
    {
        id              : string;
        value           : string;
        alt?            : string;
        autoPlay?       : boolean;
        maxWidth?       : number | string;
        maxHeight?      : number | string;
        width?          : number | string;
        sx?             : any;
        onClick?        : () => void;
        onTimeUpdate?   : ( time : number ) => void;   // native playback position, in seconds
        seekTo?         : number;                      // seconds offset to seek to (paired with `seekNonce`)
        seekNonce?      : number;                      // bump on every seek request, even to the same `seekTo`
    }
}

export default VideoInput;
// eof