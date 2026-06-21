//
import React from 'react';
import { JSX } from "react";


//
import { InputLabel, MenuItem, FormHelperText, FormControl, ListItemIcon, Divider, Typography } from '@mui/material';
import { Select, SelectChangeEvent } from '@mui/material';
import { StringUtils, ValueUtils } from '@repo/common';

//

//
//
//
export function SelectInput( props: SelectInput.Props ) : JSX.Element
{
    const [value, setValue] = React.useState< string >( props.value );
  
    React.useEffect( propsUpdated, [props] );
    React.useEffect( onValueChange, [value] );

    ///////////////////////////////////////////////////////////////////////////////////////////////////
    function propsUpdated() : void
    {
        if( ValueUtils.notNull( props.value )
            && props.choices.length > 0
            && props.value
            && props.value !== value
            && hasValue( props.value ) )
        {
            setValue( props.value );
        }
    }

    ////////////////////////////////////////////////////////////////////////////////
    function hasValue( value : string ) : boolean
    {
        const choiceValues : Array<string> = props.choices.map( ( choice : SelectInput.Choice ) => choice.value );
        return choiceValues.includes( value );
    }

    ////////////////////////////////////////////////////////////////////////////////
    function onValueChange() : void
    {
        //console.log( 'onValueChange', { id: props.id, propsv : props.value, value: value } );

        // ignorePropertyValue is an override when the property value cannot be updated by the
        // parent component.  This becocmes a one-way component
        if( props.onChange !== undefined
            && ( props.value !== value || ( props.ignorePropertyValue !== undefined && props.ignorePropertyValue ) ) )
        {
            props.onChange( value );
        }
            
    }

    ////////////////////////////////////////////////////////////////////////////////
    function onChange( event: SelectChangeEvent ) : void
    {
        if( props.choices.length > 0 )setValue( event.target.value );
    }

    ////////////////////////////////////////////////////////////////////////////////
    function renderValue( selected: any ) : string
    {
        const selected_choice : SelectInput.Choice | undefined = props.choices.find( ( choice : SelectInput.Choice ) => choice.value === selected );
        return selected_choice ? ( selected_choice.label as string ) : '';
    }

    // ===============================================================================================
    return <FormControl sx ={ { m: 0,
                                flex    : props.sx !== undefined && props.sx.flex !== undefined ? props.sx.flex : undefined,
                                minWidth   : props.sx !== undefined && props.sx.width !== undefined ? props.sx.width : 150
                            } }
                            disabled={ props.disabled != undefined ? props.disabled : false }
                            size    ={ props.dense != undefined ? ( props.dense ? "small" : "medium" ) : "small" }
                            required={ props.required != undefined ? props.required : false } >

                <InputLabel id={ props.id + "-select-label"}>{ props.label }</InputLabel>
                
                <Select
                        labelId     = { props.id + "-select-label-id"}
                        id          = { props.id }
                        value       = { value && hasValue( value ) ? value : "" }
                        multiple    = { false }
                        label       = { props.label }
                        renderValue={ renderValue }
                        onChange    = { onChange }
                        inputProps  = {{ readOnly: props.readOnly != null ? props.readOnly : false }}
                    >
                        { props.choices.map(( item : SelectInput.Choice, index : number ) => 
                                {   if( item.divider === undefined || item.divider === false )
                                        return    <MenuItem key={ props.id + '-' + index }
                                                            value={ item.value }
                                                            disabled={ item.disabled !== undefined ? item.disabled : false }
                                                            selected={ ( item.disabled !== undefined && !item.disabled ) ||  item.disabled === undefined ? item.value === value : false }>
                                                    { item.icon ?<ListItemIcon sx={{minWidth: 32,verticalAlign:'center'}}> { item.icon }</ListItemIcon> : null }
                                                    { item.label }
                                                </MenuItem>
                                    else
                                        return <Divider textAlign="left">{ item.label !== null ? <Typography color="primary">{ item.label }</Typography> : null }</Divider>
                                } ) }
                </Select>
                { props.helperText != null ? ( <FormHelperText>{ props.helperText  }</FormHelperText> ) : null }
            </FormControl>;


}

////////////////////////////////////////////////////////////////////////////////////////////////
/**
 * Single selection drop down menu of name/value pairs.
 * @param id ID of the component
 * @param label Label of the component
 * @param value Value or selection of the choices
 * @param choices Array of choices for the user to select from. Minimally the choices are value/label pairs.
 * @param onChange Optional callback funtions that is called when the selection changes.
 * @param disabled Optional flag to disable the component.
 * @param helperText Optional property to provide some help prompt to the selection.
 * @param readOnly Optional flag to make the component read-only.
 * @param required Optional flag to denote that the selection is required.
 * @param sx Special extension of layout of the component, including width and flex.
 * @param dense Optional flag to compress (if true) the height of the selections.
 */
export namespace SelectInput
{
    export interface Choice
    {
        value       : string;
        label       : string | JSX.Element | null;
        divider?    : boolean;
        disabled?   : boolean;
        icon?       : JSX.Element;
        data?       : any;
    }

    //
    // helper function to take an eumberation and convert that to a list of choices
    //
    export function enumToChoices( value : any ) : Array<Choice>
    {
        const keys   : Array<string> = Object.keys( value );
        const values : Array<string> = Object.values( value );
        let choices : Array<SelectInput.Choice>  = [];
        keys.forEach( ( key : string, index : number ) => { choices.push( { value : values[index], label : StringUtils.enumToString( key )} ) }  );
        return choices;
    }

    export interface Props
    {
        id          : string;
        label       : string;
        disabled?   : boolean;
        helperText? : string;
        readOnly?   : boolean;
        required?   : boolean;
        sx?         : { width? : string | number, flex? : number }
        value       : string;
        choices     : Array<SelectInput.Choice>;
        dense?      : boolean;
        ignorePropertyValue? : boolean;
        onChange?   : ( value: string ) => void;
    }
}

export default SelectInput;
// eof