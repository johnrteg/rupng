//
import React from 'react';
import { JSX } from "react";


export function WindowResizer( props : WindowResizer.Props ) : JSX.Element | null
{
    const timer                      = React.useRef< ReturnType<typeof setTimeout> | null >( null );

    //
    React.useEffect( () => componentLoaded(), [] );
    React.useEffect( () => ()=> componentUnLoaded(), [] );

    ////////////////////////////////////////////////////////////////////////////////////////////
    function componentLoaded() : void
    {
        window.addEventListener("resize", onResize );

        // init
        props.onChange( window.innerWidth, window.innerHeight );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    function componentUnLoaded() : void
    {
        window.removeEventListener("resize", onResize );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    function onResize() : void
    {
        if( timer.current )clearTimeout( timer.current );
        timer.current = setTimeout( doWindowResize, props.delay !== undefined ? props.delay : 250 );
    }

    //////////////////////////////////////////////////////////////////////
    function doWindowResize( ) : void
    {
        timer.current = null;
        props.onChange( window.innerWidth, window.innerHeight );
    }


    //
    //
    //
    return null;
}

export namespace WindowResizer
{
    export interface Props
    {
        delay? : number;
        onChange    : ( width: number, height : number ) => void;
    }
}

export default WindowResizer;

// eof