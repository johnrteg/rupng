import AppModel from "@model/AppModel";
//
import React from 'react';
import { JSX } from "react";

import LocaleService from "@model/service/LocaleService";
import SelectInput   from "@widgets/core/SelectInput";

//
// CountryCodeInput — a country dropdown labelled with its calling-code prefix ("US +1"), value = the ISO 3166-1
// alpha-2 code. This is the country selector extracted from TelephoneInput so it can be reused wherever a
// country + dial-code is picked (e.g. an import map's PHONE_E164 default country). Driven by the account's
// configured countries (bootstrap), with a US fallback.
//
export function CountryCodeInput( props : CountryCodeInput.Props ) : JSX.Element
{
    const appmodel : AppModel = AppModel.instance();
    const locale : LocaleService = appmodel.ui.locale;

    // the account's configured countries (fall back to US if the bootstrap hasn't landed)
    const countries : Array<string> = props.only && props.only.length > 0 ? props.only
        : ( appmodel.config.countries && appmodel.config.countries.length > 0 ? appmodel.config.countries : [ "US" ] );

    // one choice per country, labelled "US +1" (matches TelephoneInput)
    const choices : Array<SelectInput.Choice> = countries.map( ( country : string ) : SelectInput.Choice => ( { value: country, label: `${ country } ${ locale.phonePrefix( country ) }` } ) );

    return  <SelectInput id={ props.id }
                         label={ props.label ?? "Country" }
                         value={ props.value ?? "" }
                         choices={ choices }
                         disabled={ props.disabled ?? false }
                         onChange={ props.onChange }
                         sx={ props.sx } />;
}

export namespace CountryCodeInput
{
    export interface Props
    {
        id        : string;
        label?    : string;
        value?    : string;                       // ISO 3166-1 alpha-2 (e.g. "US")
        only?     : Array<string>;                // restrict to these ISO codes (default: the account's countries)
        disabled? : boolean;
        sx?       : { width? : string | number; flex? : number };   // matches SelectInput's sx
        onChange  : ( value : string ) => void;   // the picked ISO code
    }
}

export default CountryCodeInput;
// eof
