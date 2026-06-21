//
import React from 'react';
import { JSX } from "react";

//
import { TextField, Autocomplete, Chip } from '@mui/material';
import { HighlightOff as HighlightOffIcon } from '@mui/icons-material';
import { ArrayUtils, StringUtils } from "@repo/common";


//
//
export default function TagInput( props: TagInput.Props ) : JSX.Element
{
    const [choices, setChoices]         = React.useState< Array<string> >( props.choices ?? [] );
    const [values, setValues]           = React.useState< Array<string> >( props.value );
    const [disabled, setDisabled]       = React.useState< boolean >( props.disabled == undefined ? false : props.disabled );
    const addPrefix                     = React.useRef< string >( "+ " );

    //
    React.useEffect( valuesChanged, [values] );
    React.useEffect( propValuesUpdated, [props.value] );
    React.useEffect( propChoicesUpdated, [props.choices] );
    React.useEffect( propDisabledUpdated, [props.disabled] );

    ////////////////////////////////////////////////////////////////////////////////////////////
    function propValuesUpdated() : void
    {
        //console.log('TagInput props', props.values );
        if( props.value &&
            ( props.value.length !== values.length ||
             !props.value.every( (v : string, i : number ) => v === values[i]))
        )
        {
            setValues( props.value ?? [] );
        }
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    function propChoicesUpdated() : void
    {
        setChoices( props.choices ?? [] );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    function propDisabledUpdated() : void
    {
        setDisabled( props.disabled == undefined ? false : props.disabled  );
    }

    ///////////////////////////////////////////////////////////////////////////////////////////
    function valuesChanged() : void
    {
        //console.log('valuesChanged', props.value, values );
        if( props.onChange && props.value && values && !ArrayUtils.isSame( props.value, values ) )
        {
            props.onChange( values );
        }
    }

    ////////////////////////////////////////////////////////////////////////////////////////////////////////
    function onChange( event: React.SyntheticEvent<Element, Event>, new_value : Array<string> ) : void
    {
        // Remove "+ " prefix if present
        let cleaned : Array<string> = new_value.map( val =>
            typeof val === "string" && val.startsWith( addPrefix.current ) ? val.slice(2) : val
        );

        //console.log('onChange', cleaned );

        // convert to upper case if properties wants it to be.
        if( props.allUpperCase !== undefined && props.allUpperCase )
        {
            cleaned = cleaned.map(val => typeof val === "string" ? val.toUpperCase() : val);
        }

        // convert to lowoer case if properties wants it to be.
        if( props.allLowerCase !== undefined && props.allLowerCase )
        {
            cleaned = cleaned.map( val => typeof val === "string" ? val.toLowerCase() : val );
        }

        // convert enforce no spaces.
        if( props.noSpaces !== undefined && props.noSpaces )
        {
            cleaned = cleaned.map( val => typeof val === "string" ? StringUtils.removeAllSpaces( val ) : val );
        }

        if( props.maxTags && props.maxTags > 0 )
        {
            if( cleaned && cleaned.length > props.maxTags )
            {
                // Replace the last tag with the newly selected one
                const replaced : Array<string> = cleaned.slice(0, props.maxTags - 1).concat(cleaned[cleaned.length - 1]);
                setValues( replaced );
            }
            else
            {
                setValues( cleaned );
            }
        }
        else
        {
            setValues( cleaned );
        }
    }

    //////////////////////////////////////////////////////////////////////////////////////////////////
    function onFilter( options: Array<string>, params : any ) : Array<string>
    {
        //console.log('onFilter', options, params);
        const { inputValue } = params;
        //const filtered : Array<string> = choices;//= filter( options, params );

        // Filter choices that include the inputValue (case-insensitive)
        const filtered = choices.filter( ( option : string ) =>
            option.toLowerCase().includes( inputValue.toLowerCase() )
        );

        const isExisting : boolean = choices.some( ( option : string ) => option.toLowerCase() === inputValue.toLowerCase());
        if( inputValue !== '' && !isExisting )
        {
            filtered.push( addPrefix.current + inputValue );
        }
     
        return filtered;
    }

    //////////////////////////////////////////////////////////////////////////////////////
    function getLabel( option : string ) : string
    {
        return option;
    }

    //////////////////////////////////////////////////////////////////////////////////////
    function onRenderOptions( props : any, option : string ) : JSX.Element
    {
        return <li key={ option } {...props}>{ option }</li>;
    }

    /////////////////////////////////////////////////////////////////////////////////////
    function onRenderInput( params : any ) : JSX.Element
    {
        return <TextField {...params} label={ props.label } required={ props.required } />;
    }

    /////////////////////////////////////////////////////////////////////////////////////
    function onRenderTags( value : Array<string>, getTagProps : any ) : React.ReactNode
    {
        return value.map( ( tag : string, index : number ) => (
                    <Chip
                        key={ index.toString() }
                        variant="outlined"
                        label={ props.onFormat !== undefined ? props.onFormat( tag ) : tag }
                        disabled={ disabled }
                        color={ props.onTagValid === undefined || props.onTagValid( tag ) ? "default" : "error" }
                        size={ props.size ? props.size : "medium" }
                        deleteIcon={ disabled ? undefined : <HighlightOffIcon /> }
                        {...getTagProps({ index })}
                    />
                ) );
    }


    return <Autocomplete
                id={ props.id }
                value={ values }
                selectOnFocus={ true }
                clearOnBlur={ true }
                handleHomeEndKeys={ true }
                options={ values }
                limitTags={ props.limitTags ?? -1 }
                fullWidth={ true }
                freeSolo={ true }
                size={ props.size ?? "small" }
                filterSelectedOptions={ true }
                disabled={ disabled }
                disableClearable={ props.disableClearable ?? false }
                multiple={ true }
                autoComplete={ true }
                sx={{ flex: 1 }}
                onChange={ onChange }
                filterOptions={ onFilter }
                getOptionLabel={ getLabel }
                renderOption={ onRenderOptions }
                renderInput={ onRenderInput }
                renderValue={ onRenderTags }
            />;
                 
}

export namespace TagInput
{
    export interface Props
    {
        id                  : string;
        label               : string;
        value               : Array<string>; 
        choices             : Array<string>;
        limitTags?          : number;
        maxTags?            : number;
        disabled?           : boolean;
        disableClearable?   : boolean;
        //disallowAdd?        : boolean;

        required?           : boolean;

        // format
        allUpperCase?       : boolean;
        allLowerCase?       : boolean;
        noSpaces?           : boolean;
        onTagValid?         : ( value : string ) => boolean;
        onFormat?           : ( value : string ) => string;

        size?               : "medium" | "small";
        onChange?           : ( values: Array<string> ) => void;
    }
}




// eof