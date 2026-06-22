//
import React from 'react';
import { JSX } from "react";
import { Slider, Stack } from '@mui/material';

import BedtimeOutlinedIcon          from '@mui/icons-material/BedtimeOutlined';
import WbSunnyOutlinedIcon          from '@mui/icons-material/WbSunnyOutlined';
import { DateUtils }                from '@repo/common';


export function TimeSliderInput( props : TimeSliderInput.Props ) : JSX.Element | null
{
    const [values, setValues]         = React.useState< Array<number> >( props.value );

    React.useEffect( valueChanged, [values] );
    //React.useEffect( propsValueChanged, [props.value] );

    ///////////////////////////////////////////////////////////////////////////////////////////////////////
    function valueChanged() : void
    {
        if( props.value[0] !== values[0] || props.value[1] !== values[1] )props.onChange( values );
    }

/*
    ///////////////////////////////////////////////////////////////////////////////////////////////////////
    function propsValueChanged() : void
    {
        if( props.value[0] !== values[0] || props.value[1] !== values[1] )setValues( props.value );
    }
*/

    ///////////////////////////////////////////////////////////////////////////////////////////////////////
    function outsourceWindowText(value: number) : string
    {
        const hours   : number = Math.floor( value );
        const minutes : string = String( Math.round( (value - hours) * 60 ) ).padStart( 2, '0' );
        return DateUtils.parseTimeTo12HourClock( `${hours}:${minutes}` );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////////////////
    function outsourceWindowChange( event: Event, newValue: Array<number> | number, activeThumb: number ) : void
    {
        const min_distance  : number = props.spacing;  // hours -> config?
        const new_value     : Array<number> = newValue as Array<number>;
        let next            : Array<number>;

        if( new_value[1] - new_value[0] < min_distance )
        {
            if( activeThumb === 0 )
            {
                const clamped : number = Math.min(new_value[0], props.max - min_distance);
                next = [clamped, clamped + min_distance];
            }
            else
            {
                const clamped : number = Math.max(new_value[1], min_distance);
                next = [clamped - min_distance, clamped];
            }
        }
        else
        {
            next = new_value;
        }

        requestAnimationFrame( () => setValues( next ) );
    }

    return <Stack direction="row">
                <WbSunnyOutlinedIcon sx={ { mt: 1.2} } fontSize="small"  /> 
                <Slider
                        sx={ { width: props.width, mx: 1, mt: 0.5 } }
                        disableSwap={ true }
                        min={ props.min }
                        max={ props.max }
                        step={ 0.25 }
                        valueLabelFormat={ outsourceWindowText }
                        marks={ [   {value: 8,label: '8AM'},
                                    {value: 10,label: '10AM'},
                                    {value: 12,label: '12N'},
                                    {value: 14,label: '2PM'},
                                    {value: 16,label: '4PM'},
                                    {value: 18,label: '6PM'},
                                    {value: 20,label: '8PM'},
                                    {value: 22,label: '10PM'} ] }
                        valueLabelDisplay="on"
                        value={ values }
                        onChange={ outsourceWindowChange }
                                                            
                    />
                <BedtimeOutlinedIcon sx={ { mt: 1.2} } fontSize="small" />
    </Stack>
}

export namespace TimeSliderInput
{
    export interface Props
    {
        min : number;
        max : number;
        spacing : number; // hours
        width : string | number;
        value : Array<number>;
        onChange : ( values : Array<number> ) => void;
    }
}

export default TimeSliderInput;
// eof