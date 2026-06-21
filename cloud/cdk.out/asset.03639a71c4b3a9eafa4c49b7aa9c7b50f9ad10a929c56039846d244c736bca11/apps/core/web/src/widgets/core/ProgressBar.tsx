//
import React from 'react';
import { JSX } from "react";

//
import { Box, Stack } from '@mui/material';

//
//
//



//
//
//
export function ProgressBar( props : ProgressBar.Props ) : JSX.Element
{
    /////////////////////////////////////////////////////////////////////////////////////
    function barColor( index : number ) : string
    {
        if( props.colors && index < props.colors.length )
        {
            return props.colors[index];
        }
        else
        {
            return "green";
        }
    }

    // ==================================================================================
    let bars : Array<JSX.Element> = [];
    let total : number = 0;
    //console.log(props.values);
    props.values.forEach( ( value : number, index : number ) => { bars.push( <Box key={index} sx={ { width: value + "%", height: (props.height?props.height:5)+"px", bgcolor: barColor(index), border:1, borderColor: "white" } } /> ); total += value } );
    if( total < 100 )bars.push( <Box key={props.values.length} sx={ { width: ( 100 - total ) + "%", height: (props.height?props.height:5)+"px", bgcolor: props.bgColor ? props.bgColor : "#c8e6c9", border:1, borderColor: "white" } } /> );

    return <Stack sx={ { width: "100%", p: 0, ...props.sx } } spacing={0} direction={"row"} >{ bars }</Stack>;

}

export namespace ProgressBar
{
    export interface Props
    {
        values      : Array<number>;
        colors?     : Array<string>;
        bgColor?    : string;
        height?     : number;
        sx?         : any;
    }
}


export default ProgressBar;

// eof