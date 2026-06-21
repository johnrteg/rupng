//
import React from 'react';
import { JSX } from "react";


export function Timer( props : Timer.Props ) : JSX.Element | null
{
    const [run,setRun]               = React.useState< boolean >( props.run );
    const [value,setValue]           = React.useState< number >( 0 );

    const timer                      = React.useRef< ReturnType<typeof setTimeout> | null >( null );
    const value_ref                  = React.useRef< number >( 0 );

    //
    React.useEffect( () => ()=> componentUnLoaded(), [] );
    React.useEffect( runChanged, [run] );
    React.useEffect( valueChanged, [value] );
    React.useEffect( propsChanged, [props.run] );

    ////////////////////////////////////////////////////////////////////////////////////////////
    function componentUnLoaded() : void
    {
        clear();
    }

    ///////////////////////////////////////////////////////////////////////////////////////////
    function clear() : void
    {
        if( timer.current )
        {
            clearInterval( timer.current );
            timer.current = null;
        }
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    function propsChanged() : void
    {
        setRun( props.run );
    }

    ///////////////////////////////////////////////////////////////////////////////////////////
    function runChanged() : void
    {
        // avoid the fist call to this when initilized
        if( run )
        {
            // if being asked to run again, stop current one first
            clear();
            timer.current = setInterval( onUpdate, props.interval );
        }
        else
        {
            clear();
        }
    }

    ///////////////////////////////////////////////////////////////////////////////////////////
    function onUpdate() : void
    {
        setValue( value_ref.current + 1 );
    }

    ///////////////////////////////////////////////////////////////////////////////////////////
    function valueChanged() : void
    {
        value_ref.current = value;  // init to 0

        // avoid the fist callback if not running
        if( run )props.onChange()
    }



    //
    //
    //
    return null;
}

/**
 * Timer component that calls onChange() on each tick while running.
 *
 * @param props.run - start/stop the timer
 * @param props.interval - interval in milliseconds between ticks
 * @param props.onChange - callback invoked on each tick
 */
export namespace Timer
{
    export interface Props
    {
        run         : boolean;
        interval    : number;       // miliseconds
        onChange    : () => void;
    }
}

export default Timer;
// eof