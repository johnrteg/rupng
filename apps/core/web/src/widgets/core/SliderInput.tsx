//
import React from 'react';
import { JSX } from "react";

//
import { FormControlLabel, Slider } from '@mui/material';
import { ArrayUtils, StringUtils, ValueUtils } from '@repo/common';






//
//
//
export function SliderInput( props : SliderInput.Props ) : JSX.Element
{
    // state
    const [value,setValue]            = React.useState< number | number[] >( props.value );
    const [label,setLabel]            = React.useState< string >( updateLabel( props.value ) );

    //
    React.useEffect( propsUpdated, [props] );

    ///////////////////////////////////////////////////////////////////////////////////////////////////
    function propsUpdated() : void
    {
        setValue( props.value );
        setLabel( updateLabel( props.value ) );
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////////
    function onChange( event: Event, newValue: number | number[] ) : void
    {
        //evt.preventDefault();
        setValue( newValue );
        if( props.onChange )props.onChange( newValue );
        setLabel( updateLabel( newValue ) );
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////////
    function updateLabel( value : number | number[] ) : string
    {
        if( ArrayUtils.isValid( value ) )
        {
            return StringUtils.format( "{0}: {1}{2}", props.label, ( value as number[] ).join("-"), ValueUtils.notNull( props.isPercent ) && props.isPercent ?  "%" : "" );
        }
        else
        {
            return StringUtils.format( "{0}: {1}{2}", props.label, ( value as number ).toLocaleString(), ValueUtils.notNull( props.isPercent ) && props.isPercent ?  "%" : "" );
        }
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////////
    function onChangeCommitted( event: React.SyntheticEvent | Event, newValue: number | number[] ) : void
    {
        if( props.onChangeCommitted )props.onChangeCommitted( newValue );
    }

    const slider : JSX.Element = <Slider    name={props.id}
                                            value={ value }      
                                            valueLabelDisplay="auto"
                                            disableSwap={true}
                                            min={ props.min ?? props.min }
                                            max={ props.max ?? props.max }
                                            step={ ValueUtils.notNull( props.step ) ? props.step : 1 }
                                            onChangeCommitted= {onChangeCommitted}
                                            onChange= {onChange}/>;

    // https://mui.com/material-ui/react-slider/
    return <FormControlLabel    sx={ { width: props.width, pl: 0, pr: 3, '& .MuiFormControlLabel-label': { fontSize: '14px' } }}
                                control={ slider }
                                label={ label }
                                labelPlacement={ props.labelPlacement != undefined ? props.labelPlacement : "start" } />;

}

export namespace SliderInput
{
    export interface Props
    {
        id                : string;
        label             : string;
        labelPlacement?   : "start" | "end" | "top" | "bottom";
        value             : number | number[];
        disabled?         : boolean;
        width?            : number | string;
        min?              : number;
        max?              : number;
        step?             : number;
        isPercent?        : boolean;
        onChange?         : ( new_value : number | number[] ) => void;
        onChangeCommitted? : ( new_value : number | number[] ) => void;
    }
}



export default SliderInput;
// eof