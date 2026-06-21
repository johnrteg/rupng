//
import React from 'react';
import { JSX } from "react";

//
import { TextField, Autocomplete} from '@mui/material';
import { AutocompleteChangeReason, createFilterOptions } from '@mui/material/Autocomplete';
import { StringUtils, ValueUtils } from '@repo/common';

//



const filter = createFilterOptions< ComboInput.Choice >();


//
//
//
export function ComboInput( props : ComboInput.Props ) : JSX.Element
{
    // state
    const [value,setValue]  = React.useState< ComboInput.Choice | null >( null );
    const [choices,setChoices]  = React.useState< Array< ComboInput.Choice > >( props.choices );

    //
    React.useEffect( () => propValueUpdated(), [props.value,choices] );
    React.useEffect( () => propChoicesUpdated(), [props.choices] );

    ///////////////////////////////////////////////////////////////////////////////////////////////////
    function propValueUpdated() : void
    {
        if( props.value )
        {
            const found : ComboInput.Choice | undefined = props.choices.find( ( v : ComboInput.Choice ) => v.value === props.value );
            if( found !== undefined )
            {
                setValue( found );
            }
        }
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////
    function propChoicesUpdated() : void
    {
        setChoices( props.choices );
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////
    function onFilter( options: Array<ComboInput.Choice>, params : any ) : Array<ComboInput.Choice>
    {
        const filtered : Array<ComboInput.Choice> = filter( options, params );

        if( ValueUtils.notNull( props.allowAdd ) && props.allowAdd )
        {
            const { inputValue } = params;
            // Suggest the creation of a new value
            const isExisting : boolean = options.some( ( option : ComboInput.Choice ) => inputValue === option );
            if( inputValue !== '' && !isExisting )
            {
                filtered.push({ value: inputValue, label: `+ "${inputValue}"` });
            }
        }
   
        return filtered;
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////
    function onEquality( option: ComboInput.Choice, new_value: ComboInput.Choice ) : boolean
    {
        //console.log('onEquality', option, value, ObjectUtils.isNull( value ), value == "" );
        if( ValueUtils.notNull( props.allowAdd ) && props.allowAdd )
        {
            // allow anything to be added
            return true;
        }
        else
        {
            // null or blank string
            if( ValueUtils.isNull( new_value ) )
            {
                return false;
            }
            else if( StringUtils.isValid( option ) && StringUtils.isValid( new_value ) )
            {
                return option === new_value;
            }
            else
            {
                return ( option.value === new_value.value );
            } 
        }
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////////
    function onChange( new_value : ComboInput.Choice | null, reason: AutocompleteChangeReason ) : void
    {
        if( new_value && new_value.label.startsWith( '+ "' ) )
        {
            // Extract the raw value from the label
            const raw_value = new_value.value;

            //console.log('onChange', new_value, reason, hasChoice( raw_value ) );

            const newChoice: ComboInput.Choice = { value: raw_value, label: raw_value };
            setChoices( prev => [...prev, newChoice ] );
            setValue( newChoice );
            if( props.onChange )props.onChange( raw_value );
        }
        else
        {
            setValue( new_value );
            if( props.onChange )props.onChange( new_value ? new_value.value : null );
        }
    }


    // 
    // ===============================================================================================
    return <Autocomplete
                    disablePortal={ false }
                    id         = { props.id }
                    value      = { value }
                    options    = { choices }
                    size       = "small"
                    sx         = { { width: props.sx && props.sx.width ? props.sx.width : undefined } }
                    disabled   = { props.disabled ?? false }
                    fullWidth  = { props.fullWidth ?? true }
                    isOptionEqualToValue={ onEquality } 
                    filterOptions={ onFilter }
                    onChange={ (event: any, newValue: ComboInput.Choice | null, reason: AutocompleteChangeReason ) => { onChange( newValue, reason ); }}
                    renderInput= { (params) => <TextField {...params} label={ props.label + ( props.required !== undefined && props.required ? "*" : "" )} />}
            />;

}


export namespace ComboInput
{
    export interface Choice
    {
        value : string;
        label : string;
    }

    export interface Props
    {
        id              : string;
        label           : string;
        value           : string | null;
        choices         : Array<ComboInput.Choice>;
        fullWidth?      : boolean;
        sx?             : { width?        : string | number; };
        disabled?       : boolean;
        required?       : boolean;
        allowAdd?       : boolean;
        onChange?       : ( new_value : string | null ) => void;
    }
}

export default ComboInput;

// eof