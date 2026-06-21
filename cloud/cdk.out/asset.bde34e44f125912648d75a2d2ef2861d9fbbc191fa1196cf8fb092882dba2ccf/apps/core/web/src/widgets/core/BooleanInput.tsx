//
import React from 'react';
import { JSX } from "react";

//
import SelectInput from "./SelectInput";
import AppModel from '@model/AppModel';




//
//
//
export function BooleanInput( props : BooleanInput.Props ) : JSX.Element
{
    const appmodel : AppModel = AppModel.instance();
    
    // state
    const [checked,setChecked]            = React.useState< string >(props.value ? "yes" : "no" );

    //
    React.useEffect( () => propsUpdated(), [props] );

    ///////////////////////////////////////////////////////////////////////////////////////////////////
    function propsUpdated() : void
    {
        setChecked( props.value ? "yes" : "no" );
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////////
    function onChange( new_value : string ) : void
    {
        setChecked( new_value );
        if( props.onChange )props.onChange( new_value == "yes" );
    }

    // ===============================================================================================
    return <SelectInput id={props.id} label={props.label} value={checked}
                                    disabled={ props.disabled != null ? props.disabled : false }
                                    choices={[ { value: "yes", label: appmodel.ui.locale.label( 'common.button.yes' ) }, { value: "no", label: appmodel.ui.locale.label( 'common.button.no' )  } ]}
                                    onChange={ onChange } />;
}

export namespace BooleanInput
{
    export interface Props
    {
        id        : string;
        label     : string;
        value     : boolean;
        disabled? : boolean;
        onChange? : ( new_value : boolean ) => void;
    }
}


export default BooleanInput;

// eof