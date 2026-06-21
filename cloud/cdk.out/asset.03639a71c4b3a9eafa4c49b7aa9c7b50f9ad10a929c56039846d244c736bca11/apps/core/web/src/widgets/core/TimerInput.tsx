//
import React from 'react';
import { JSX } from "react";

//
import { Box, CircularProgress } from '@mui/material';

import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import PauseIcon from '@mui/icons-material/Pause';

import Timer from './Timer';
import { DateUtils } from '@repo/common';


export function TimerInput( props: TimerInput.Props ) : JSX.Element
{
    const [value,setValue]      = React.useState< number >( props.intervalSeconds );   // seconds
    const [run,setRun]          = React.useState< boolean >( true );

    //
    React.useEffect( onChange, [props.intervalSeconds] );

    /////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    function onChange() : void
    {
        setValue( props.intervalSeconds );
    }

    /////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    function onClick( evt : React.MouseEvent<HTMLButtonElement> ) : void
    {
        evt.preventDefault();
        evt.stopPropagation();
        //props.onClick();
    }

    /////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    function onToggle() : void
    {
        setRun( !run );
    }

    /////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    function onTick() : void
    {
        if( value === 1 )
        {
            props.onUpdate();
            setValue( props.intervalSeconds );
        }
        else
        {
            setValue( value - 1 );
        }
    }

    return  <Box sx={ { pt: props.sx && props.sx.pt ? props.sx.pt : 0 } }>
                <Box sx={{ position: "relative", display: "inline-block", width: 26, height: 26 }}>
                    { run ? <PlayArrowIcon fontSize="small" color="primary"
                                    sx={{
                                        position: "absolute",
                                        top: "50%",
                                        left: "50%",
                                        transform: "translate(-50%, -50%)",
                                        zIndex: 1,
                                        //color: "grey.400",
                                        pointerEvents: "none"
                                    }}/> :
                    <PauseIcon fontSize="small" color="primary"
                                    sx={{
                                        position: "absolute",
                                        top: "50%",
                                        left: "50%",
                                        transform: "translate(-50%, -50%)",
                                        zIndex: 1,
                                        //color: "grey.400",
                                        pointerEvents: "none"
                                    }}/> }
                    <CircularProgress   variant="determinate"
                                        size={"100%"}
                                        thickness={ 6 }
                                        value={ ( value / props.intervalSeconds ) * 100 }
                                        sx={{ position: "absolute", top: 0, left: 0, zIndex: 2, cursor: "pointer" }} 
                                        onClick={ onToggle } />
                </Box>
                
                <Timer  run={run}
                        interval={ ( props.updateIntervalSeconds !== undefined ? props.updateIntervalSeconds : 1 ) * DateUtils.Time.SECONDS_TO_MS }
                        onChange={ onTick } />
            </Box>;
}


/**
 * TimerInput component thas a countdown display that when done, will call onUpdate.
 * Has the ability to pause and restart the timer on mouse click.
 *
 * @param props.id - id of the component
 * @param props.label - Label / tool tip
 * @param props.intervalSeconds - Interval (in seconds) before the onUpdate callback is called.
 * @param props.updateIntervalSeconds - Intervale (in seconds) for the display progress to be updated.
 * @param props.sx - Style extension
 * @param props.onUpdate - callback invoked when time interval has been reached
 */
export namespace TimerInput
{
    export interface Props
    {
        id                      : string;
        label                   : string;
        intervalSeconds         : number;
        updateIntervalSeconds?  : number;           //
        sx?                     : { pt? : number };
        onUpdate                : () => void;
    }
}


export default TimerInput;

// eof