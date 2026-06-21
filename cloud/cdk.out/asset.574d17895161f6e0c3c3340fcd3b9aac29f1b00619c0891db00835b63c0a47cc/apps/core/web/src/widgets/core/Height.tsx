//
import React from 'react';
import { JSX } from "react";

import WindowResizer from './WindowResizer';

export function Height( props : Height.Props ) : JSX.Element | null
{
    const tableTopRef = React.useRef<HTMLDivElement>(null);

    const offset = React.useRef<number>(props.offset);

    React.useEffect( offsetChanged, [props.offset] );

    //////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    function offsetChanged() : void
    {
        offset.current = props.offset;
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////////////
    function onWindowChange( width : number, height : number ) : void
    {
        if( tableTopRef.current )props.onChange( height - tableTopRef.current.getBoundingClientRect().bottom -  offset.current );
    }

    //
    //
    //
    return ( <div ref={ tableTopRef }><WindowResizer delay={ 100 } onChange={ onWindowChange }/></div> );
}

export namespace Height
{
    export interface Props
    {
        offset    : number;
        onChange    : ( height : number ) => void;
    }
}

export default Height;

// eof