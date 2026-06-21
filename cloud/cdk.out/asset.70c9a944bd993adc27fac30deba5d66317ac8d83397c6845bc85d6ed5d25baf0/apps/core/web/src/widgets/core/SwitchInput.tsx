//
import React from 'react';
import { JSX } from "react";


//
import { FormControlLabel, Switch, Typography } from '@mui/material';


//
//
//
export function SwitchInput( props : SwitchInput.Props ) : JSX.Element
{
    // state
    const [checked,setChecked]            = React.useState< boolean >( props.value) ;

    //
    React.useEffect( propsUpdated, [props] );

    ///////////////////////////////////////////////////////////////////////////////////////////////////
    function propsUpdated() : void
    {
        if( checked !== props.value )setChecked( props.value );
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////////
    function onChange( evt : any ) : void
    {
        //evt.preventDefault();
        setChecked( evt.target.checked );
        if( props.onChange )props.onChange( evt.target.checked );
    }

     // ===============================================================================================
    return <FormControlLabel control={ <Switch name={ props.id }
                                                checked={ checked }
                                                color={ props.color ?? "default"}
                                                onChange= { onChange }/>}
                            label={ <Typography noWrap>{ props.label }</Typography> }
                            disabled={ props.disabled ?? false }
                            labelPlacement={ props.labelPlacement ?? "start" }/>;

   
}

export namespace SwitchInput
{
    export interface Props
    {
        id              : string;
        label     :      string;
        labelPlacement? : "start" | "end" | "top" | "bottom";
        value           : boolean;
        disabled?       : boolean;
        color?          : "primary" | "secondary" | "error" | "info" | "success" | "warning" | "default";
        onChange?       : ( new_value : boolean ) => void;
    }
}


export default SwitchInput;
// eof