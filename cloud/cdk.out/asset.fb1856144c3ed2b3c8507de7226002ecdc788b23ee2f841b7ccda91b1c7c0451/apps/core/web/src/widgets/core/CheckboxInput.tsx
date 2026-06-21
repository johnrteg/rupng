//
import React from 'react';
import { JSX } from "react";


//
import { FormControlLabel, Checkbox, Theme, useTheme } from '@mui/material';




//
//
//
export function CheckboxInput( props : CheckboxInput.Props ) : JSX.Element
{
    const theme : Theme = useTheme();
    
    const [checked,setChecked]            = React.useState< boolean >( props.value );

    React.useEffect( () => propsUpdated(), [props] );

    ///////////////////////////////////////////////////////////////////////////////////////////////////
    function propsUpdated() : void
    {
        if( props.value !== checked )setChecked( props.value );
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////////
    function onChange( event : React.ChangeEvent<HTMLInputElement>, checked: boolean ) : void
    {
        //evt.preventDefault();
        setChecked( checked );//evt.target.checked );
        if( props.onChange )props.onChange( checked );//evt.target.checked );
    }


    // ===============================================================================================
    // sx={ [ { p: 0, m: 0 }, props.sx ] }
    return ( <FormControlLabel  required={ props.required ?? false }
                                sx={ { p: 0, m: 0,
                                        width: props.sx && props.sx.width ? props.sx.width : undefined,
                                        color: ( props.sx && props.sx.textColor ? props.sx.textColor : theme.palette.text.primary ),
                                        whiteSpace: props.allowWrap !== undefined ? props.allowWrap ? 'normal' : 'nowrap' : 'nowrap' } }
                                disabled={ props.disabled ?? false }
                                label={ props.label }
                                control={<Checkbox name={props.id}
                                                    checked={ checked }
                                                    onChange={onChange}
                                                    sx={{ pl: 0, pt: 0, pr: 1, pb: 0, m: 0,
                                                    '&.Mui-checked' : { color: props.sx && props.sx.buttonColor ? props.sx.buttonColor : theme.palette.primary.main }
                                                    }}
                                        />}
                /> );
}

export namespace CheckboxInput
{
    export interface Props
    {
        id          : string;
        label       : string;
        value       : boolean;
        disabled?   : boolean;
        required?   : boolean;
        allowWrap?  : boolean;
        sx?         : { textColor? : string, buttonColor? : string, width? : number };
        onChange?   : ( new_value : boolean ) => void;
    }
}

export default CheckboxInput;
// eof