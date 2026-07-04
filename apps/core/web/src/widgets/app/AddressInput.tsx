//
import { JSX } from "react";

import { Box, Stack } from "@mui/material";

import { Type } from "@repo/common";

import TextInput    from "@widgets/core/TextInput";
import CountryInput from "@widgets/core/CountryInput";
import ZipInput     from "@widgets/core/ZipInput";

//
// AddressInput — the standard postal-address editor (street, city, state, ZIP, country) as one control,
// so every place that edits an address (account details, billing address, …) looks + behaves the same.
// Composes the house inputs: CountryInput (the country drives ZipInput's format/validation) + ZipInput.
// Emits the whole Type.Address on any change (preserving `location`).
//
export function AddressInput( props : AddressInput.Props ) : JSX.Element
{
    const address : Type.Address = props.value;

    ////////////////////////////////////////////////////////////////////////////////////////////
    function patch( change : Partial<Type.Address> ) : void
    {
        props.onChange( { ...address, ...change } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // two-column responsive grid (stacks on narrow content)
    function grid( children : JSX.Element ) : JSX.Element
    {
        return <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" }, gap: 2 }}>{ children }</Box>;
    }

    return  <Stack spacing={ 2 }>
                <TextInput id={ `${ props.id }-street1` } label={"Street"} value={ address.street1 } disabled={ props.disabled } onChange={ ( value ) => patch( { street1: value } ) } fullWidth />
                <TextInput id={ `${ props.id }-street2` } label={"Street (line 2)"} value={ address.street2 } disabled={ props.disabled } onChange={ ( value ) => patch( { street2: value } ) } fullWidth />
                { grid( <>
                    <TextInput id={ `${ props.id }-city` } label={"City"} value={ address.city } disabled={ props.disabled } onChange={ ( value ) => patch( { city: value } ) } fullWidth />
                    <TextInput id={ `${ props.id }-state` } label={"State / region"} value={ address.state } disabled={ props.disabled } onChange={ ( value ) => patch( { state: value } ) } fullWidth />
                </> ) }
                { grid( <>
                    <ZipInput id={ `${ props.id }-zip` } label={"ZIP / postal code"} value={ address.zip } country={ address.country } disabled={ props.disabled } onChange={ ( value ) => patch( { zip: value } ) } />
                    <CountryInput id={ `${ props.id }-country` } label={"Country"} value={ address.country } disabled={ props.disabled } onChange={ ( value ) => patch( { country: value ?? "" } ) } />
                </> ) }
            </Stack>;
}

export namespace AddressInput
{
    /** A blank address — a convenient seed for a new/unset address. */
    export const EMPTY : Type.Address = { street1: "", street2: "", city: "", state: "", zip: "", country: "" };

    export interface Props
    {
        id        : string;
        value     : Type.Address;
        disabled? : boolean;
        onChange  : ( address : Type.Address ) => void;
    }
}

export default AddressInput;
