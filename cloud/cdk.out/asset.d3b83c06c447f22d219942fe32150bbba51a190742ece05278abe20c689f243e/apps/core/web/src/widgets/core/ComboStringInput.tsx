//
import React from 'react';
import { JSX } from "react";

//
import { Grid, TextField, Autocomplete } from '@mui/material';
import { AutocompleteChangeReason, createFilterOptions } from '@mui/material/Autocomplete';
import { StringUtils, ValueUtils } from '@repo/common';

//



const filter = createFilterOptions< string >();


//
//
//
export function ComboStringInput( props : ComboStringInput.Props ) : JSX.Element
{
    // state
    const [value,setValue]  = React.useState< string | null >( null );

    //
    React.useEffect( () => propsUpdated(), [props] );

    ///////////////////////////////////////////////////////////////////////////////////////////////////
    function propsUpdated() : void
    {
        //console.log('combo:props', props.value );
        if( props.value != value )setValue( props.value );
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////
    function onFilter( options: Array<string>, params : any ) : Array<string>
    {
        //console.log('onFilter', options, params);
        const filtered : Array<string> = filter( options, params );

        if( ValueUtils.notNull( props.allowAdd ) && props.allowAdd )
        {
            const { inputValue } = params;
            // Suggest the creation of a new value
            //const isExisting : boolean = options.some( ( option : TagChoice ) => inputValue === option.label );
            const isExisting : boolean = options.some( ( option : string ) => inputValue === option );
            if( inputValue !== '' && !isExisting )
            {
                //filtered.push({ inputValue, label: `Add "${inputValue}"` });
                //filtered.push( `Add "${inputValue}"` );
                filtered.push( inputValue );
            }
        }
        
        return filtered;
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////
    function onEquality( option: string, value: string ) : boolean
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
            if( ValueUtils.isNull( value ) || ( StringUtils.isValid( value ) && value == "" ) )
            {
                return false;
            }
            else //if( Validator.isString( option ) && Validator.isString( value ) )
            {
                return option === value;
            }
            //else
            //{
            //    return ( option as ComboChoice ).value === ( value as ComboChoice ).value;
            //} 
        }
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////////
    function onChange( new_value : string, reason: AutocompleteChangeReason ) : void
    {
        //console.log('onChange', new_value, reason );
        setValue( new_value );
        if( props.onChange )
        {
            if( ValueUtils.isNull( new_value ) )
            {
                props.onChange( null );
            }
            else
            {
                //if( Validator.isString( new_value ) )
                    props.onChange( new_value );
                //else
                //    props.onChange( ( new_value as ComboChoice ).value );
            }
        }
    }


    let sx : any = {};
    if( ValueUtils.notNull( props.width ) )sx = { width: props.width };

    // 

    // ===============================================================================================
    return <Autocomplete
                        disablePortal={ false }
                        id         = { props.id }
                        value      = { value }
                        options    = { props.choices }
                        size       = "small"
                        sx         = { sx }
                        disabled   = { props.disabled ?? false }
                        fullWidth  = { props.fullWidth ?? true }
                        disableClearable={!props.allowClear}
                        isOptionEqualToValue={ onEquality } 
                        filterOptions={ onFilter }
                        onChange={ ( event: any, newValue: string | null, reason: AutocompleteChangeReason ) => { onChange( newValue as string, reason ); }}
                        renderInput= { (params) => <TextField {...params} label={ props.label } />}
                    />;


}


export namespace ComboStringInput
{
    export interface Props
    {
        id            : string;
        label         : string;
        value         : string | null;
        choices       : Array<string>;
        fullWidth?    : boolean;
        width?        : number;
        disabled?     : boolean;
        allowAdd?     : boolean;
        allowClear?   : boolean;
        onChange?     : ( new_value : string | null ) => void;
    }
}


export default ComboStringInput;

// eof