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

    ////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    function valueChanged() : void
    {
        if( props.value !== url )setUrl( props.value );
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
    }
}

export default VideoInput;
// eof