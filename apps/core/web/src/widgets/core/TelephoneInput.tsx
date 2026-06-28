//
import React from 'react';
import { JSX } from "react";

import { Box, TextField } from '@mui/material';

//
import AppModel       from "@model/AppModel";
import LocaleService  from "@model/service/LocaleService";

import SelectInput    from "@widgets/core/SelectInput";

import { StringUtils } from '@repo/common';


//
// A country-aware phone field: a country/calling-code dropdown (e.g. "US +1") ahead of the number,
// driven by the configured countries (appmodel.config.countries). The number's placeholder, as-you-type
// formatting, validation, and E.164 normalization all come from the locale (LocaleService → PhoneFormat),
// so the same rules apply everywhere. onChange emits the **E.164** value when the number is valid for the
// selected country (e.g. "+18583331234"), otherwise the raw national digits while it's still incomplete.
//
export function TelephoneInput( props : TelephoneInput.Props ) : JSX.Element
{
    const appmodel : AppModel      = AppModel.instance();
    const locale   : LocaleService = appmodel.ui.locale;

    // configured countries (bootstrap) — fall back to the locale default if none came across yet
    const countries : Array<string> = appmodel.config.countries && appmodel.config.countries.length > 0
        ? appmodel.config.countries
        : [ "US" ];

    const [country,setCountry]  = React.useState< string >( () => detectCountry( props.value, countries[ 0 ] ) );
    const [phone,setPhone]      = React.useState< string >( () => locale.phoneFormatPartial( props.value ?? "", detectCountry( props.value, countries[ 0 ] ) ) );

    //
    React.useEffect( phoneUpdated, [ props.value ] );

    ////////////////////////////////////////////////////////////////////////////////////////////////////
    // Pick the country for an incoming value: keep `fallback` unless the value is an E.164 whose calling
    // code matches a *different* configured country (so a "+44…" paste flips to GB, but "+1…" stays put).
    function detectCountry( value : string | undefined, fallback : string ) : string
    {
        const v : string = ( value ?? "" ).trim();
        if( v.startsWith( "+" ) )
        {
            const prefix : string = locale.phonePrefix( fallback );
            if( prefix && v.startsWith( prefix ) ) return fallback;          // already matches — don't move
            const match : string | undefined = countries.find( ( c : string ) => { const p : string = locale.phonePrefix( c ); return p !== "" && v.startsWith( p ); } );
            if( match ) return match;
        }
        return fallback;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////////////
    function phoneUpdated() : void
    {
        if( props.value === undefined ) return;
        const c : string = detectCountry( props.value, country );
        const formatted : string = locale.phoneFormatPartial( props.value, c );
        if( c !== country ) setCountry( c );
        if( formatted !== phone ) setPhone( formatted );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////////////
    // emit E.164 when the number is valid for the country, else the raw national digits (still typing)
    function emit( display : string, c : string ) : void
    {
        const e164   : string | null = locale.phoneToE164( display, c );
        const out    : string        = e164 ?? StringUtils.toPhoneNumber( display );
        if( out !== props.value && props.onChange !== undefined ) props.onChange( out );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////////////
    function onChange( evt : React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement> ) : void
    {
        evt.preventDefault();
        const formatted : string = locale.phoneFormatPartial( evt.target.value, country );
        setPhone( formatted );
        emit( formatted, country );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////////////
    // changing the country re-formats / re-validates the current digits under the new country's rules
    function onCountryChange( c : string ) : void
    {
        setCountry( c );
        const formatted : string = locale.phoneFormatPartial( phone, c );
        setPhone( formatted );
        emit( formatted, c );
    }

    // ============================================================================================

    // invalid only once something's been entered (empty isn't an error here)
    const invalid : boolean = phone.trim() !== "" && !locale.phoneValid( phone, country );

    // keep enough room for the dropdown + formatted number even inside a flex row
    const minWidth : number | string = props.minWidth ?? 220;

    // one choice per configured country, labelled "US +1"
    const countryChoices : Array<SelectInput.Choice> = countries.map( ( c : string ) => ( { value: c, label: `${c} ${locale.phonePrefix( c )}` } ) );

    return <Box sx={{ display: "flex", gap: 1, alignItems: "flex-start", width: props.fullWidth ? "100%" : ( props.sx ? props.sx.width : undefined ), minWidth }}>

                <SelectInput id={ `${props.id}-country` }
                             label=""
                             value={ country }
                             choices={ countryChoices }
                             disabled={ ( props.disabled ?? false ) || countries.length <= 1 }
                             onChange={ onCountryChange }
                             sx={{ width: 104 }} />

                <TextField  id          = { props.id }
                            label       = { props.label }
                            placeholder = { locale.phonePlaceholder( country ) }
                            size        = "small"
                            value       = { phone }
                            error       = { invalid }
                            autoFocus   = { props.autoFocus ?? false }
                            autoComplete= { props.autoComplete }
                            disabled    = { props.disabled ?? false }
                            fullWidth   = { true }
                            sx          = {{ flexGrow: 1 }}
                            onChange    = { ( evt: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement> ) => onChange( evt ) }
                />
            </Box>;
}

export namespace TelephoneInput
{
    export interface Props
    {
        id              : string;
        label           : string;
        value           : string;
        autoFocus?      : boolean;
        autoComplete?   : string;
        disabled?       : boolean;
        fullWidth?      : boolean;
        minWidth?       : number | string;
        sx?             : { width : number | string };
        onChange?       : ( value : string ) => void;
    }
}


export default TelephoneInput;
// eof
