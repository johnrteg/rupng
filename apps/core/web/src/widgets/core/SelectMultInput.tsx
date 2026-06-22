//
import React from 'react';
import { JSX } from "react";


//
import { InputLabel, MenuItem, FormHelperText, FormControl, ListItemIcon, ListSubheader, Divider, Chip } from '@mui/material';
import { Select } from '@mui/material';
import { ValueUtils } from '@repo/common';

//

//



export function SelectMultInput( props: SelectMultInput.Props ) : JSX.Element
{
    const [value, setValue] = React.useState< Array<string> >( props.value );
  
    //
    React.useEffect( () => propsUpdated(), [props] );
    React.useEffect( onValueChange, [value] );

    ///////////////////////////////////////////////////////////////////////////////////////////////////
    function propsUpdated() : void
    {
        if( ValueUtils.notNull( props.value )
            && props.choices.length > 0
            && props.value
            && !isEqual( props.value, value )
            && hasValue( props.value ) )
        {
            setValue( props.value );
        }
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////
    function isEqual(a: string | Array<string>, b: string | Array<string>): boolean
    {
        if (Array.isArray(a) && Array.isArray(b))
        {
            if (a.length !== b.length) return false;
            return a.every((val, idx) => val === b[idx]);
        }
        return a === b;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////////////////
    function hasValue( value : Array<string> ) : boolean
    {
        const choiceValues = props.choices.map( choice => choice.value );
        return value.every( val => choiceValues.includes( val ) );
    }

    /////////////////////////////////////////////////////////////////////////////////////////////////////////
    function onValueChange() : void
    {
         if( props.onChange )props.onChange( value );
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////////////
    function onChange( event: any, child?: React.ReactNode ) : void
    {
        let newValue: string | Array<string>;
        newValue = event.target.value as unknown as Array<string>;
        setValue(newValue);
    }

    ////////////////////////////////////////////////////////////////////////////////////////////////////////////
    function onRenderValue( selected : Array<string> ) : React.ReactNode
    {
        return selected.map((val, idx) => {
        const option : SelectMultInput.Choice | undefined = props.choices.find(choice => choice.value === val);
        return option ? (
                <Chip
                    key={option.value}
                    variant="outlined"
                    label={option.label}
                    sx={ { pt : 0.5 } }
                    size={props.dense ? "small" : "medium"}
                />
            ) : null;
        });
    }

    // ===============================================================================================
    return <FormControl sx ={ { m: 0,
                                minWidth: props.minWidth != undefined ? props.minWidth : 150
                            } }
                            disabled={ props.disabled != undefined ? props.disabled : false }
                            size    ={ props.dense != undefined ? ( props.dense ? "small" : "medium" ) : "small" }
                            required={ props.required != undefined ? props.required : false } >

                <InputLabel id={ props.id + "-select-label"}>{ props.label }</InputLabel>

                <Select
                        labelId     = { props.id + "-select-label-id"}
                        id          = { props.id }
                        value       = { value }
                        multiple    = { true }
                        label       = { props.label }
                        onChange    = { onChange }
                        renderValue = { onRenderValue }
                        inputProps  = {{ readOnly: props.readOnly != null ? props.readOnly : false }}
                    >
                        { props.choices.map(( item : SelectMultInput.Choice, index : number ) => 
                                {   if( item.value != "" )
                                        return    <MenuItem key={ props.id + '-' + index }
                                                            value={ item.value }
                                                            selected={ value.includes(item.value) }>
                                                    { item.icon ?<ListItemIcon sx={{minWidth: 32,verticalAlign:'center'}}> { item.icon }</ListItemIcon> : null }
                                                    { item.label }
                                                </MenuItem>
                                    else
                                        return <ListSubheader color="primary"><Divider textAlign="left">{ item.label }</Divider></ListSubheader>
                                } ) }
                </Select>
                { props.helperText != null ? ( <FormHelperText>{ props.helperText  }</FormHelperText> ) : null }
            </FormControl>;


}

//
//
//
export namespace SelectMultInput
{
    export interface Choice
    {
        value : string;
        label : string | JSX.Element;
        icon? : any;
    }

    export interface Props
    {
        id          : string;
        label       : string;
        disabled?   : boolean;
        helperText? : string;
        readOnly?   : boolean;
        required?   : boolean;
        minWidth?   : number | string;
        value       : Array<string>;
        choices     : Array<SelectMultInput.Choice>;
        dense?      : boolean;
        onChange?   : ( value: Array<string> ) => void;
    }
}



export default SelectMultInput;
// eof