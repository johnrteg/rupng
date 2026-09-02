//
import React from 'react';
import { JSX } from "react";

import { Stack } from "@mui/material";

import TextInput from '@widgets/core/TextInput';
import DialogWindow from '@widgets/core/DialogWindow';

//
// TollFreeVerificationDialog — submit the business-attestation details a toll-free number needs for A2P
// eligibility (registration-4.x). Async: lands SUBMITTED; the real decision (VERIFIED/REJECTED) arrives via a
// carrier webhook or a staff correction, not this call.
//
export function TollFreeVerificationDialog( props : TollFreeVerificationDialog.Props ) : JSX.Element
{
    const [businessName,setBusinessName]       = React.useState< string >( "" );
    const [businessWebsite,setBusinessWebsite] = React.useState< string >( "" );
    const [useCase,setUseCase]                 = React.useState< string >( "" );
    const [optInWorkflow,setOptInWorkflow]     = React.useState< string >( "" );
    const [monthlyVolume,setMonthlyVolume]     = React.useState< string >( "" );

    const volume : number = parseInt( monthlyVolume, 10 );
    const ready : boolean = businessName.trim() !== "" && businessWebsite.trim() !== "" && useCase.trim() !== "" &&
        optInWorkflow.trim() !== "" && Number.isFinite( volume ) && volume >= 0;

    ////////////////////////////////////////////////////////////////////////////////////////////
    function onYes() : Promise<boolean>
    {
        return props.onSubmit( {
            businessName: businessName.trim(), businessWebsite: businessWebsite.trim(),
            useCase: useCase.trim(), optInWorkflow: optInWorkflow.trim(), monthlyVolume: volume,
        } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    return  <DialogWindow id="registration-tfv" title={ `Verify ${ props.number }` } yesLabel={"Submit for verification"} cancelLabel={"Cancel"}
                          minWidth="sm" ready={ ready } onYes={ onYes } onClose={ props.onClose }>
                <Stack spacing={ 2 } sx={{ pt: 1 }}>
                    <TextInput id="tfv-business-name" label={"Business name"} value={ businessName } onChange={ setBusinessName } fullWidth />
                    <TextInput id="tfv-business-website" label={"Business website"} value={ businessWebsite } onChange={ setBusinessWebsite } fullWidth />
                    <TextInput id="tfv-use-case" label={"Use case"} value={ useCase } onChange={ setUseCase } multiline maxRows={ 3 } fullWidth
                              placeHolder={"What this number will be used to send"} />
                    <TextInput id="tfv-opt-in-workflow" label={"Opt-in workflow"} value={ optInWorkflow } onChange={ setOptInWorkflow } multiline maxRows={ 3 } fullWidth
                              placeHolder={"How recipients opt in to receive messages"} />
                    <TextInput id="tfv-monthly-volume" label={"Estimated monthly volume"} value={ monthlyVolume } onChange={ setMonthlyVolume } allNumeric fullWidth />
                </Stack>
            </DialogWindow>;
}

export namespace TollFreeVerificationDialog
{
    export interface Draft { businessName : string; businessWebsite : string; useCase : string; optInWorkflow : string; monthlyVolume : number; }

    export interface Props
    {
        number  : string;
        onSubmit : ( draft : Draft ) => Promise<boolean>;
        onClose  : () => void;
    }
}

export default TollFreeVerificationDialog;
// eof
