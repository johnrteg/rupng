//
import React from 'react';
import { JSX } from "react";

import { Stack } from "@mui/material";

import { Registration } from '@repo/api';

import DialogWindow from '@widgets/core/DialogWindow';
import TextInput     from '@widgets/core/TextInput';
import SelectInput   from '@widgets/core/SelectInput';

//
// BrandFormDialog — create the account's TCR brand (registration-1.0/1.1, brand-per-account). Only entity
// type + the always-required fields are collected here; the SOLE_PROPRIETOR/company/public-company
// conditional fields (firstName/lastName vs companyName/ein vs stockSymbol/stockExchange) show based on the
// chosen entity type, mirroring the domain's own entity-type-conditional validation.
//
export function BrandFormDialog( props : BrandFormDialog.Props ) : JSX.Element
{
    const [entityType,setEntityType]   = React.useState< Registration.EntityType >( Registration.EntityType.PRIVATE_PROFIT );
    const [firstName,setFirstName]     = React.useState< string >( "" );
    const [lastName,setLastName]       = React.useState< string >( "" );
    const [companyName,setCompanyName] = React.useState< string >( "" );
    const [ein,setEin]                 = React.useState< string >( "" );
    const [stockSymbol,setStockSymbol] = React.useState< string >( "" );
    const [stockExchange,setStockExchange] = React.useState< string >( "" );
    const [email,setEmail]             = React.useState< string >( "" );
    const [phone,setPhone]             = React.useState< string >( "" );
    const [street,setStreet]           = React.useState< string >( "" );
    const [city,setCity]               = React.useState< string >( "" );
    const [state,setState]             = React.useState< string >( "" );
    const [postalCode,setPostalCode]   = React.useState< string >( "" );
    const [country,setCountry]         = React.useState< string >( "US" );
    const [vertical,setVertical]       = React.useState< Registration.Vertical >( Registration.Vertical.TECHNOLOGY );

    const isSoleProprietor : boolean = entityType === Registration.EntityType.SOLE_PROPRIETOR;
    const isPublicProfit   : boolean = entityType === Registration.EntityType.PUBLIC_PROFIT;

    const ready : boolean = email.trim() !== "" && phone.trim() !== "" && street.trim() !== "" && city.trim() !== "" &&
        state.trim() !== "" && postalCode.trim() !== "" && country.trim() !== "" &&
        ( isSoleProprietor ? firstName.trim() !== "" && lastName.trim() !== "" : companyName.trim() !== "" );

    ////////////////////////////////////////////////////////////////////////////////////////////
    function onYes() : Promise<boolean>
    {
        return props.onSave( {
            entityType, email: email.trim(), phone: phone.trim(), street: street.trim(), city: city.trim(),
            state: state.trim(), postalCode: postalCode.trim(), country: country.trim(), vertical,
            firstName: isSoleProprietor ? firstName.trim() : undefined,
            lastName:  isSoleProprietor ? lastName.trim() : undefined,
            companyName: !isSoleProprietor ? companyName.trim() : undefined,
            ein:         !isSoleProprietor ? ein.trim() || undefined : undefined,
            stockSymbol:   isPublicProfit ? stockSymbol.trim() || undefined : undefined,
            stockExchange: isPublicProfit ? stockExchange.trim() || undefined : undefined,
        } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    return  <DialogWindow id="registration-brand-form" title={"Register your brand"} yesLabel={"Create brand"} cancelLabel={"Cancel"}
                          minWidth="sm" ready={ ready } onYes={ onYes } onClose={ props.onClose }>
                <Stack spacing={ 2 } sx={{ pt: 1 }}>
                    <SelectInput id="brand-entity-type" label={"Entity type"} value={ entityType }
                                choices={ SelectInput.enumToChoices( Registration.EntityType ) } onChange={ ( value : string ) : void => setEntityType( value as Registration.EntityType ) } />

                    { isSoleProprietor
                        ? <Stack direction="row" spacing={ 2 }>
                            <TextInput id="brand-first-name" label={"First name"} value={ firstName } onChange={ setFirstName } fullWidth />
                            <TextInput id="brand-last-name"  label={"Last name"}  value={ lastName }  onChange={ setLastName }  fullWidth />
                          </Stack>
                        : <TextInput id="brand-company-name" label={"Company name"} value={ companyName } onChange={ setCompanyName } fullWidth /> }

                    { !isSoleProprietor && <TextInput id="brand-ein" label={"EIN (tax id)"} value={ ein } onChange={ setEin } fullWidth /> }
                    { isPublicProfit &&
                        <Stack direction="row" spacing={ 2 }>
                            <TextInput id="brand-stock-symbol"   label={"Stock symbol"}   value={ stockSymbol }   onChange={ setStockSymbol }   fullWidth />
                            <TextInput id="brand-stock-exchange" label={"Stock exchange"} value={ stockExchange } onChange={ setStockExchange } fullWidth />
                        </Stack> }

                    <SelectInput id="brand-vertical" label={"Industry"} value={ vertical }
                                choices={ SelectInput.enumToChoices( Registration.Vertical ) } onChange={ ( value : string ) : void => setVertical( value as Registration.Vertical ) } />

                    <TextInput id="brand-email" label={"Contact email"} value={ email } onChange={ setEmail } fullWidth />
                    <TextInput id="brand-phone" label={"Contact phone"} value={ phone } onChange={ setPhone } fullWidth />
                    <TextInput id="brand-street" label={"Street address"} value={ street } onChange={ setStreet } fullWidth />
                    <Stack direction="row" spacing={ 2 }>
                        <TextInput id="brand-city"  label={"City"}  value={ city }  onChange={ setCity }  fullWidth />
                        <TextInput id="brand-state" label={"State"} value={ state } onChange={ setState } fullWidth />
                        <TextInput id="brand-postal" label={"Postal code"} value={ postalCode } onChange={ setPostalCode } fullWidth />
                    </Stack>
                    <TextInput id="brand-country" label={"Country"} value={ country } onChange={ setCountry } fullWidth />
                </Stack>
            </DialogWindow>;
}

export namespace BrandFormDialog
{
    export interface Draft
    {
        entityType     : Registration.EntityType;
        firstName?     : string;
        lastName?      : string;
        companyName?   : string;
        ein?           : string;
        stockSymbol?   : string;
        stockExchange? : string;
        email          : string;
        phone          : string;
        street         : string;
        city           : string;
        state          : string;
        postalCode     : string;
        country        : string;
        vertical       : Registration.Vertical;
    }

    export interface Props
    {
        onSave  : ( draft : Draft ) => Promise<boolean>;
        onClose : () => void;
    }
}

export default BrandFormDialog;
// eof
