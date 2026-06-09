//
import React from 'react';
import { JSX } from "react";

//
import { TextField, Autocomplete, Chip, Theme, useTheme } from '@mui/material';
import { AutocompleteChangeReason, createFilterOptions } from '@mui/material/Autocomplete';

//
import { HighlightOff as HighlightOffIcon } from '@mui/icons-material';
import { ArrayUtils } from "@repo/common";

//



const filter = createFilterOptions< ComboMultInput.Choice >();


//
//
//
export function ComboMultInput( props : ComboMultInput.Props ) : JSX.Element
{
    const theme : Theme = useTheme();
    const borderColor : string = theme.palette.mode === 'dark' ? theme.palette.grey[700] : theme.palette.grey[300];

    // state
    const [values,setValues]  = React.useState< Array<ComboMultInput.Choice> >( initValues() );

    //
    React.useEffect( propsValueUpdated, [props.value] );
    React.useEffect( propsChoicesUpdated, [props.choices] );
    //React.useEffect( valuesUpdated, [values] );

    ///////////////////////////////////////////////////////////////////////////////////////////////////
    function propsValueUpdated() : void
    {
        const diff_values : Array<ComboMultInput.Choice> = initValues();

        const different : boolean = diff_values.length !== values.length
                                    || diff_values.some( ( dv : ComboMultInput.Choice ) => !values.some( ( v : ComboMultInput.Choice ) => v.value === dv.value))
                                    || values.some( ( v : ComboMultInput.Choice ) => !diff_values.some( ( dv : ComboMultInput.Choice ) => dv.value === v.value));
        //console.log('propsValueUpdated', props.value, values, different );
        if( different )setValues( diff_values );
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////
    function propsChoicesUpdated() : void
    {
        const diff_values : Array<ComboMultInput.Choice> = initValues();
        setValues( diff_values );
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    function initValues() : Array<ComboMultInput.Choice>
    {
        let new_values : Array<ComboMultInput.Choice> = [];
        if( props.value !== null )props.value.forEach( ( val : string ) => { new_values.push( { value: val, label: getChoiceLabel( val ) } ) } );
        return new_values;
    }

    //////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    function getChoiceLabel( value : string ) : string
    {
        const found : ComboMultInput.Choice | undefined = props.choices.find( ( choice : ComboMultInput.Choice ) => choice.value === value);
        return found ? found.label : value; // fallback to value if not found
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////////////
    function onFilter( options: Array<ComboMultInput.Choice>, params : any ) : Array<ComboMultInput.Choice>
    {
        const filtered = filter( options, params );
        return filtered;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////////////////////
    function onEquality( option: ComboMultInput.Choice, new_value: ComboMultInput.Choice ) : boolean
    {
        // compare by value (Choice objects)
        if( !option || !new_value ) return false;
        return option.value === new_value.value;
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////////
    function onChange( new_values : Array<ComboMultInput.Choice>, reason: AutocompleteChangeReason ) : void
    {
        let given_values : Array<string> = [];
        new_values.forEach( ( item : ComboMultInput.Choice ) => { given_values.push( item.value ) } );

        //console.log('ON CHANGE', getCurrentValues(), new_values );

        setValues( new_values );

        // notify parent immediately (avoid relying on the values useEffect)
        if( props.onChange && !ArrayUtils.isSame( props.value, given_values ) )
        {
            props.onChange( given_values );
        }
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////////
    function onRenderInput( params : any ) : JSX.Element
    {
        return <TextField {...params}   placeholder= { props.placeHolder ?? props.placeHolder }
                                        label={ props.label + ( ( props.required !== undefined && props.required === true ) ? "*" : "" ) } 
                                        />;
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////////////
    function onRenderValue( value : Array<ComboMultInput.Choice>, getItemProps : any | undefined ) : React.ReactNode
    {
        return value.map( ( option:ComboMultInput.Choice, index:number ) => (
                    <Chip
                        key={ option.value }
                        variant="outlined"
                        label={ option.label }
                        size={ props.size ? props.size : "medium" }
                        deleteIcon={<HighlightOffIcon />}
                        sx={ { borderColor: borderColor } }
                        {...getItemProps({ index })}
                    />
                ) );
    }


    // 
    //
    //
    return <Autocomplete
                        disablePortal   = { false }
                        id              = { props.id }
                        value           = { values }
                        options         = { props.choices }
                        size            = { props.size ? props.size : "small" }
                        sx              = { {   width   : props.sx && props.sx.width ? props.sx.width : undefined,
                                                maxWidth: props.sx && props.sx.maxWidth ? props.sx.maxWidth : undefined } }
                        disabled        = { props.disabled ?? false }
                        fullWidth       = { props.fullWidth ?? true }
                        //slots           = { { popper: CustomPopper } }
                        multiple        = { true }
                        isOptionEqualToValue={ onEquality }
                        getOptionKey    = { ( option : ComboMultInput.Choice ) => option.value }
                        getOptionLabel  = { ( option : ComboMultInput.Choice ) => option.label as string }
                        getOptionDisabled={ ( option : ComboMultInput.Choice ) => option.disabled ?? false }
                        filterOptions   = { onFilter }
                        onChange        = { (event: any, newValue: Array<ComboMultInput.Choice>, reason: AutocompleteChangeReason ) => { onChange( newValue, reason ); }}
                        renderInput     = { onRenderInput }
                        renderValue     = { onRenderValue }
                    />;
}

/**
 * Component to display multiple chips of name/value items that the user can select from
 *
 * @param props.id ID of the component
 * @param props.label Label of the component
 * @param props.value Array of values that corresponds to the established choices
 * @param props.choices Array of name/value pairs to select from.
 * @param props.fullWidth Optional flag to push the component to the full width of the parent container.
 * @param props.sx Optional Special Extentions to the display of the component.
 * @param props.disabled Optional flag to disable the interaction with the component
 * @param props.placeHolder Optioanl place holder text for the component.
 * @param props.size Optional setting to make the chips normal (medium) in size or small.
 * @param props.onChange OPtional callback to get called when the selection of choices are made.
 */
export namespace ComboMultInput
{
    export interface Choice
    {
        value    : string;
        label    : string;
        disabled?: boolean;
    }

    export interface Props
    {
        id            : string;
        label         : string;
        value         : Array<string>;
        choices       : Array<ComboMultInput.Choice>;
        fullWidth?    : boolean;

        required?       : boolean;

        sx?           : {   width?        : string | number;
                            maxWidth?     : number | string;
                        };

        disabled?     : boolean;
        placeHolder?  : string;
        size?         : "medium" | "small";

        onChange?     : ( new_value : Array<string> ) => void;
    }
}

export default ComboMultInput;
// eof