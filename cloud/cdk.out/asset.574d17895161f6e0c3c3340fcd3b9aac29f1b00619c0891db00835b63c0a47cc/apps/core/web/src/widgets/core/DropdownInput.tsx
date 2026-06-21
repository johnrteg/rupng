//
import React from 'react';
import { JSX } from "react";

//
import Stack            from '@mui/material/Stack';
import { Box } from '@mui/material';

//
import ComboMultInput   from '@widgets/core/ComboMultInput';
import SelectInput      from '@widgets/core/SelectInput';

//
import ComboInput from './ComboInput';
import { ArrayUtils } from '@repo/common';


export function DropdownInput( props : DropdownInput.Props ) : JSX.Element
{
    const [values, setValues]           = React.useState< Array<string> >( props.value );
    const [choices, setChoices]         = React.useState< Array<DropdownInput.Choice> >( props.choices );

    //
    React.useEffect( choicesPropsUpdated, [props.choices] );
    React.useEffect( choicesUpdated, [choices,props.value] );

    ///////////////////////////////////////////////////////////////////////////////////////////////////
    function choicesPropsUpdated() : void
    {
        setChoices( props.choices );
    }

    //////////////////////////////////////////////////////////////////////////////////////////////////////////////
    function onMultChange( new_ids : Array<string> ) : void
    {
        setValues( new_ids );
        props.onChange( new_ids );
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////
    function choicesUpdated() : void
    {
        // Spread to ensure a new array reference so React doesn't bail out
        // when props.value reference hasn't changed but choices just populated.
        setValues( [...props.value] );
        //console.log('DropdownInput::choicesUpdated', props.value );
    }

    //////////////////////////////////////////////////////////////////////////////////////////////////////////////
    function onChange( new_ids : string | Array<string> | null ) : void
    {
        //console.log('DropdownInput::onChange', new_ids, Validator.isArray( new_ids ) );

        if( ArrayUtils.isValid( new_ids ) )
        {
            setValues( new_ids as Array<string> );
            props.onChange( new_ids as Array<string> );
        }
        else if( new_ids as string !== "" )
        {
            setValues( [new_ids as string] );
            props.onChange( [new_ids as string ] );
        }
    }

  
    // ============================================================================================
    // 
    let input : JSX.Element | null = null;
    switch( props.type )
    {
        case "multi" : input = <ComboMultInput id={ props.id }
                                    label={ props.label }
                                    size={ "small" }
                                    disabled={ props.disabled }
                                    choices={ choices }
                                    required={ props.required }
                                    fullWidth={ true }
                                    sx={ { width : props.sx ? props.sx.width : undefined  } }
                                    value={ values }
                                    onChange={ onMultChange } />;
                        break;

        case "combo" : input = <ComboInput id={ props.id }
                                    label={ props.label }
                                    disabled={ props.disabled }
                                    choices={ choices }
                                    required={ props.required }
                                    sx={ { width : props.sx ? props.sx.width : undefined } }
                                    value={ values.length > 0 ? values[0] : "" }
                                    onChange={ onChange } />;
                        break;

        case "select" : input = <SelectInput id={ props.id }
                                    label={ props.label }
                                    disabled={ props.disabled }
                                    choices={ choices }
                                    required={ props.required }
                                    sx={ { width: props.sx && props.sx.width !== undefined ? props.sx.width : "100%" } }
                                    value={ values.length > 0 ? values[0] : "" } 
                                    onChange={ onChange } />;
                        break;
    }
    return  ( 
                <Stack direction="row" sx={ { width: "100%", boxSizing: "border-box"  } }>
                    <Box sx={{ flex: 1 }}>
                        { input }
                    </Box>
                    { props.endAction !== undefined ? props.endAction : null }
                </Stack>
                
            );

}

////////////////////////////////////////////////////////////////////////////////////////////////
/**
 * Dropdown menu that allows easier control of the type of dropdown.
 *
 * @param id ID of the component
 * @param label Label of the component.
 * @param value Initial or current value of the channel.
 * @param choices Choices to select from.
 * @param type Type of dropdown.
 * @param disabled Optional flag to disable the selection of the component.
 * @param sx Optional style extension for the component.
 * @param endAction Optional control at the end of the dropdown.
 * @param onChange Callback when the selection changes.
 */
export namespace DropdownInput
{
    export interface Choice
    {
        value       : string;
        label       : string;
        data?       : any;
    }

    export interface Props
    {
        id          : string;
        label       : string;
        value       : Array<string>;
        choices     : Array<DropdownInput.Choice>;
        type        : "select" | "combo" | "multi";

        required?   : boolean;

        sx?         : { width?: number | string; };
        disabled?   : boolean;
        endAction?  : JSX.Element;
        onChange    : ( ids: Array<string> ) => void;
    }
}

export default DropdownInput;

// eof