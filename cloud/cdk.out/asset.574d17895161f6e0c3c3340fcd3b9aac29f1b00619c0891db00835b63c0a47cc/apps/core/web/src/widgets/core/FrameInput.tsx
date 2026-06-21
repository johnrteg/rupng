//
import React from 'react';
import { JSX } from "react";

//
export function FrameInput( props: FrameInput.Props ) : JSX.Element
{
    return   <iframe
                src={props.src}
                title={props.title}
                width={props.width ? props.width : "100%" }
                height={ props.height ? props.height : 400 }
                style={ props.style ? props.style : undefined }
                allowFullScreen={ props.allowFullScreen !== undefined ? props.allowFullScreen : true }
            />
            ;
}


export namespace FrameInput
{
    export interface Props
    {
        src     : string;
        title?  : string;
        width?  : string | number;
        height? : string | number;
        style?  : React.CSSProperties;
        allowFullScreen? : boolean;
    }
}

export default FrameInput;

// eof