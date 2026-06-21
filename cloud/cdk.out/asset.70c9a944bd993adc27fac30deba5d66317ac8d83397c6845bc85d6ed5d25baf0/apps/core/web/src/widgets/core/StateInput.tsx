//
import React from 'react';
import { JSX } from "react";

import { Stack } from '@mui/material';

//

import ComboInput       from './ComboInput';
import ComboMultInput   from './ComboMultInput';
import LocaleService from '../../model/service/LocaleService';


export function StateInput( props: StateInput.Props ) : JSX.Element
{
    const [values,setValues]        = React.useState< Array<string> >( props.value );
    const [states,setStates]        = React.useState< Array<ComboInput.Choice> >( [] );
    const [disabled,setDisabled]    = React.useState< boolean >( props.disabled != undefined ? props.disabled : false );

    //
    React.useEffect( valueUpdated, [props.value] );
    React.useEffect( countryUpdated, [props.country] );
    React.useEffect( disabledChanged, [props.disabled] );

    ///////////////////////////////////////////////////////////////////////////////////////////////////
    function valueUpdated() : void
    {
        if( values != props.value )setValues( props.value );
    }

    //////////////////////////////////////////////////////////////////////
    function disabledChanged() : void
    {
        setDisabled( props.disabled != undefined ? props.disabled : false );
    }

    //////////////////////////////////////////////////////////////////////////////////////////////////
    function countryUpdated() : void
    {
        if( props.country == "US" )
        {
            setStates( LocaleService.STATES_LIST );
        }
        else
        {
            setStates( [] );
        }
    }

    //////////////////////////////////////////////////////////////////////////////////////////////////////////////
    function onMultChange( new_ids : Array<string> ) : void
    {
        setValues( new_ids );
        if( props.onChange )props.onChange( new_ids );
    }

    //////////////////////////////////////////////////////////////////////////////////////////////////////
    function onChange( new_value : string | null ) : void
    {
        setValues( new_value ? [new_value] : [] );
        if( props.onChange )props.onChange( new_value ? [new_value] : [] );
    }


    // =====================================================================================
    return <Stack direction="row" sx={ { width: "100%", boxSizing: "border-box"  } }>
            { props.multiple ?
                <ComboMultInput id={ props.id }
                                label={ props.label }
                                choices={ states }
                                value={ values }
                                size={ "small" }
                                sx={ { width : "100%" } }
                                onChange={ onMultChange } />
                    :
                <ComboInput id={ props.id }
                            label={ props.label }
                            choices={ states }
                            sx={ { width : "100%" } }
                            value={ values.length > 0 ? values[0] : null  }
                            onChange={ onChange } />
            }
            </Stack>;
            
    
}

export namespace StateInput
{
    export interface Props
    {
        id            : string;
        label         : string;
        country       : string | null;
        value         : Array<string>;
        required?     : boolean;
        disabled?     : boolean;
        multiple?     : boolean;
        onChange?     : ( new_value : Array<string> ) => void;
    }
}



export default StateInput;
// eof