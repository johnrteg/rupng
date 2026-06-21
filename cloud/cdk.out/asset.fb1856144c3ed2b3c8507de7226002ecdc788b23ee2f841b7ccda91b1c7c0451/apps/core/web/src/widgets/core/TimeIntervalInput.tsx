//
import React from 'react';
import { JSX } from "react";

//
import { Stack } from '@mui/material';

import NumericInput     from './NumericInput';
import SelectInput      from './SelectInput';
import { NumberUtils } from '@repo/common';

//
enum Unit
{
    NONE = "none",
    MINUTES = "m",
    HOURS = "h",
    WEEKS = "w",
    DAYS = "d",
}

interface TimeInterval
{
    amount : number;
    units : Unit;
}

export function TimeIntervalInput( props: TimeIntervalInput.Props ) : JSX.Element
{
    const [disabled,setDisabled]    = React.useState< boolean >( props.disabled != undefined ? props.disabled : false );

    const [amount,setAmount]        = React.useState< number >( props.value ? splitParts( props.value ).amount : 1 );
    const [units,setUnits]          = React.useState< string >( props.value ? splitParts( props.value ).units : Unit.NONE );

    //
    React.useEffect( disabledChanged, [props.disabled] );
    React.useEffect( propValueChanged, [props.value] );
    React.useEffect( dataChanged, [amount,units] );

    /////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    function disabledChanged() : void
    {
        setDisabled( props.disabled != undefined ? props.disabled : false );
    }

    /////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    function propValueChanged() : void
    {
        const parts : TimeInterval = splitParts( props.value );
        if( parts.amount !== amount )setAmount( parts.amount );
        if( parts.units !== units )setUnits( parts.units );
    }

    /////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    function splitParts( str : string ) : TimeInterval
    {
        const match : RegExpMatchArray  | null = props.value.match(/^(\d+)([a-zA-Z]+)$/);

        if( match )
        {
            const parsed_amount : number = parseInt( match[1], 10 ); // 12
            const parsed_unit   : string = match[2];                 // "w"
            return { amount: NumberUtils.isValid( parsed_amount ) && parsed_amount > 0 ? parsed_amount : 1,
                    units: [Unit.DAYS,Unit.HOURS,Unit.MINUTES,Unit.WEEKS].includes( parsed_unit as Unit ) ? parsed_unit as Unit : Unit.NONE  };
        }
        else
        {
            return { amount: 1, units: Unit.NONE };
        }
    }

    /////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    function dataChanged() : void
    {
        if( units === Unit.NONE || amount === 0 )
            props.onChange( "" );
        else
        {
            props.onChange( amount.toString() + units );
        }
    }

    //
    //
    //
    return  <Stack direction="row" spacing={ 0.5 }>

                <NumericInput   id={ props.id + "-number" }
                                label={ props.label }
                                disabled={ disabled || units === Unit.NONE }
                                minValue={ 1 }
                                maxValue={ 30 }     // make dynamic?
                                value={ amount }
                                onChange={ setAmount } />

                <SelectInput    id={ props.id + "-units" }
                                label={""}
                                disabled={ disabled }
                                sx={ { width: 120 } }
                                choices={ [ { value : Unit.NONE, label : "(None)" },
                                            { value : Unit.MINUTES, label : "Minutes" },
                                            { value : Unit.HOURS, label : "Hours" },
                                            { value : Unit.DAYS, label : "Days" },
                                            { value : Unit.WEEKS, label : "Weeks" }
                                        ] }
                                value={ units }
                                onChange={ setUnits } />
            </Stack>;

}

export namespace TimeIntervalInput
{
    export interface Props
    {
        id          : string;
        label       : string;
        disabled?   : boolean;
        value       : string;
        onChange    : ( value : string ) => void;
    }
}


export default TimeIntervalInput;

// eof