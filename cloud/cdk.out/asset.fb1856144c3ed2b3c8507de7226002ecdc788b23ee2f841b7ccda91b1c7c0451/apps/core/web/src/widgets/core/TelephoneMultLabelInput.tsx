//
import React from 'react';
import { JSX } from "react";

//
import { Autocomplete, TextField, Chip } from '@mui/material';
import { HighlightOff as HighlightOffIcon } from '@mui/icons-material';
import { PhoneUtils, StringUtils } from '@repo/common';



//
// Like TelephoneMultInput, but the selectable options are labeled phone numbers
// ({ name, value }) so the user can pick e.g. "MyCell: (858) 331-1234" from a list.
//
// The public contract stays simple: props.value and onChange are still a plain
// Array<string> of selected phone numbers - the labels are display-only and the
// name/value pairs are owned/stored by the caller (passed in via props.choices).
//
// Free typing is still allowed (a number not in the list can be entered); typed and
// selected entries that are not valid phone numbers / short codes are flagged in red.
//
export function TelephoneMultLabelInput( props: TelephoneMultLabelInput.Props ) : JSX.Element
{
    const [values,setValues]    = React.useState< Array<string> >( props.value );

    React.useEffect( propValuesUpdated, [props.value] );

    ///////////////////////////////////////////////////////////////////////////////////////////////////
    function propValuesUpdated() : void
    {
        if( props.value &&
            ( props.value.length !== values.length || !props.value.every( ( v : string, i : number ) => v === values[i] ) ) )
        {
            setValues( props.value ?? [] );
        }
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////
    // map a stored value back to its labeled choice (so the chip/option shows the name),
    // or fall back to the raw string for free-typed numbers
    function toModel( value : string ) : TelephoneMultLabelInput.Choice | string
    {
        const found : TelephoneMultLabelInput.Choice | undefined = props.choices.find( ( c : TelephoneMultLabelInput.Choice ) => c.value === value );
        return found ?? value;
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////
    function rawValue( item : TelephoneMultLabelInput.Choice | string ) : string
    {
        return typeof item === "string" ? item : item.value;
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////
    // display text for an option / chip: labeled choices show "name: (xxx) xxx-xxxx",
    // unlabeled choices and free-typed numbers show just the formatted number
    function display( item : TelephoneMultLabelInput.Choice | string ) : string
    {
        if( typeof item === "string" )return PhoneUtils.format( item );

        const number : string = StringUtils.toRichPhoneNumber( item.value );
        return item.name ? StringUtils.format( "{0}: {1}", item.name, number ) : number;
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////
    function isValid( item : TelephoneMultLabelInput.Choice | string ) : boolean
    {
        const str : string = StringUtils.toPhoneNumber( rawValue( item ) );
        return PhoneUtils.isValid( str ) || PhoneUtils.isShortCode( str );
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////
    function onChange( event : React.SyntheticEvent, new_value : Array<TelephoneMultLabelInput.Choice | string> ) : void
    {
        // collapse the option objects / free strings back down to plain phone values, de-duped
        const vals : Array<string> = new_value.map( rawValue );
        const unique : Array<string> = vals.filter( ( v : string, i : number ) => vals.indexOf( v ) === i );

        setValues( unique );
        if( props.onChange )props.onChange( unique );
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////
    function isOptionEqualToValue( option : TelephoneMultLabelInput.Choice | string, value : TelephoneMultLabelInput.Choice | string ) : boolean
    {
        return rawValue( option ) === rawValue( value );
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////
    function onFilter( options : Array<TelephoneMultLabelInput.Choice | string>, params : any ) : Array<TelephoneMultLabelInput.Choice | string>
    {
        const input : string = ( params.inputValue ?? "" ).toLowerCase();
        return props.choices.filter( ( c : TelephoneMultLabelInput.Choice ) =>
                    ( c.name ?? "" ).toLowerCase().includes( input ) || c.value.toLowerCase().includes( input ) );
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////
    function onRenderOption( liProps : any, option : TelephoneMultLabelInput.Choice | string ) : JSX.Element
    {
        return <li { ...liProps } key={ rawValue( option ) }>{ display( option ) }</li>;
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////
    function onRenderInput( params : any ) : JSX.Element
    {
        return <TextField { ...params } label={ props.label } required={ props.required } />;
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////
    function onRenderTags( value : Array<TelephoneMultLabelInput.Choice | string>, getTagProps : any ) : React.ReactNode
    {
        return value.map( ( item : TelephoneMultLabelInput.Choice | string, index : number ) =>
                    <Chip   key={ index.toString() }
                            variant="outlined"
                            label={ display( item ) }
                            disabled={ props.disabled }
                            color={ isValid( item ) ? "default" : "error" }
                            size={ props.size ?? "small" }
                            deleteIcon={ props.disabled ? undefined : <HighlightOffIcon /> }
                            { ...getTagProps( { index } ) } />
                );
    }

    //
    //
    return  <Autocomplete
                id={ props.id }
                value={ values.map( toModel ) }
                options={ props.choices }
                multiple={ true }
                freeSolo={ true }
                fullWidth={ true }
                size={ props.size ?? "small" }
                disabled={ props.disabled ?? false }
                selectOnFocus={ true }
                clearOnBlur={ true }
                handleHomeEndKeys={ true }
                filterSelectedOptions={ true }
                disableClearable={ props.disableClearable ?? false }
                sx={ { flex: 1 } }
                onChange={ onChange }
                filterOptions={ onFilter }
                isOptionEqualToValue={ isOptionEqualToValue }
                getOptionLabel={ display }
                renderOption={ onRenderOption }
                renderInput={ onRenderInput }
                renderValue={ onRenderTags }
            />;
}

export namespace TelephoneMultLabelInput
{
    export interface Choice
    {
        name?   : string;      // optional label; when omitted the chip/option shows only the number
        value   : string;
    }

    export interface Props
    {
        id                  : string;
        label               : string;
        value               : Array<string>;                   // selected phone numbers
        choices             : Array<TelephoneMultLabelInput.Choice>;   // labeled options to pick from
        disabled?           : boolean;
        disableClearable?   : boolean;
        required?           : boolean;
        size?               : "medium" | "small";
        onChange?           : ( values : Array<string> ) => void;
    }
}

export default TelephoneMultLabelInput;

// eof
