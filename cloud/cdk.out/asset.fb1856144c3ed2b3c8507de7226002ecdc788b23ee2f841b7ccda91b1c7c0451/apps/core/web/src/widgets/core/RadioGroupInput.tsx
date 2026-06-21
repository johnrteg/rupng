//
import React from 'react';
import { JSX } from "react";

//
import { FormControl, FormControlLabel, Radio, RadioGroup } from '@mui/material';


//
//
//
export function RadioGroupInput( props : RadioGroupInput.Props ) : JSX.Element
{
    const [value,setValue]    = React.useState< string | null >( props.value );
    

    ////////////////////////////////////////////////////////////////////////////////////
    function onChange( event: React.ChangeEvent<HTMLInputElement>, new_value: string ) : void
    {
        setValue( new_value );
        props.onChange( new_value );
    }

    //
    //
    //
    return <FormControl id={ props.id }
                        sx={[
                                { width: "100%" }, // your default/base styles
                                props.sx           // user overrides
                            ]}>
                <RadioGroup
                    aria-labelledby="radio-group"
                    name={ "radio-group-" + props.id }
                    value={ value }
                    sx={{ width: "100%" }}
                    row={ props.direction !== undefined && props.direction === "row" ? true : false }
                    onChange={ onChange }
                >
                    { props.choices.map( ( choice : RadioGroupInput.Choice, index : number ) =>
                            { return <FormControlLabel key={ choice.value } value={ choice.value } control={<Radio />} label={ choice.label } sx={{ width: "100%" }} /> } ) }
                </RadioGroup>
            </FormControl>;

}

export namespace RadioGroupInput
{
    export interface Choice
    {
        value : string;
        label : string;
    }

    //
    //
    //
    export interface Props
    {
        id          : string;
        value       : string | null;
        label       : string;
        choices     : Array<RadioGroupInput.Choice>
        direction?  : "row" | "column";
        sx?         : any;
        onChange    : ( value : string ) => void;
    }

}

export default RadioGroupInput;

// eof