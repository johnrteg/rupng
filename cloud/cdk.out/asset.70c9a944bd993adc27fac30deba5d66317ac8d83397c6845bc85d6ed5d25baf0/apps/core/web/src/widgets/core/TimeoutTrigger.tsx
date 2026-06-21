//
import React from 'react';
import { JSX } from "react";


export function TimeoutTrigger( props:  TimeoutTrigger.Props ) : JSX.Element | null
{
    const timer = React.useRef< ReturnType<typeof setTimeout> | null >( null );

    React.useEffect( () => () => onUnLoaded(), [] );
    React.useEffect( delayChanged, [props.delay] );

    /////////////////////////////////////////////////////////////////
    function onUnLoaded() : void
    {
        if( timer.current !== null )clearTimeout( timer.current );
    }

    /////////////////////////////////////////////////////////////////
    function delayChanged() : void
    {
        if( timer.current )clearTimeout( timer.current );
        if( props.delay > 0 )timer.current = setTimeout( onComplete, props.delay );
    }

    ////////////////////////////////////////////////////////////////
    function onComplete() : void
    {
        props.onTrigger();
        timer.current = null;
    }

    return null; // renderless
}

/**
 * TimeoutTrigger component that calls onTrigger() after a specific interval.
 *
 * @param props.delay - interval in milliseconds before callback is called
 * @param props.onTrigger - callback invoked after dealy milisecond
 */
export namespace TimeoutTrigger
{
    export interface Props
    {
        onTrigger   : () => void;
        delay       : number;
    }
}

export default TimeoutTrigger;
// eof
