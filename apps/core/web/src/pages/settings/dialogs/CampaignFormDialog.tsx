//
import React from 'react';
import { JSX } from "react";

import { Stack, Typography, Divider } from "@mui/material";

import { Registration } from '@repo/api';

import DialogWindow from '@widgets/core/DialogWindow';
import TextInput     from '@widgets/core/TextInput';
import SelectInput   from '@widgets/core/SelectInput';
import SwitchInput   from '@widgets/core/SwitchInput';

//
// CampaignFormDialog — create a TCR campaign under an already-APPROVED brand (registration-2.0). Collects the
// use-case, sample messages, compliance keyword/message triples (opt-in/help/opt-out), the compliance flags,
// and which carrier to provision numbers through.
//
export function CampaignFormDialog( props : CampaignFormDialog.Props ) : JSX.Element
{
    const [usecase,setUsecase]         = React.useState< Registration.UseCase >( Registration.UseCase.MARKETING );
    const [description,setDescription] = React.useState< string >( "" );
    const [messageFlow,setMessageFlow] = React.useState< string >( "" );
    const [sample1,setSample1]         = React.useState< string >( "" );
    const [sample2,setSample2]         = React.useState< string >( "" );
    const [optinKeywords,setOptinKeywords]   = React.useState< string >( "START, YES" );
    const [optinMessage,setOptinMessage]     = React.useState< string >( "" );
    const [helpKeywords,setHelpKeywords]     = React.useState< string >( "HELP" );
    const [helpMessage,setHelpMessage]       = React.useState< string >( "" );
    const [optoutKeywords,setOptoutKeywords] = React.useState< string >( "STOP" );
    const [optoutMessage,setOptoutMessage]   = React.useState< string >( "" );
    const [subscriberOptin,setSubscriberOptin]   = React.useState< boolean >( true );
    const [subscriberOptout,setSubscriberOptout] = React.useState< boolean >( true );
    const [subscriberHelp,setSubscriberHelp]     = React.useState< boolean >( true );
    const [privacyPolicyLink,setPrivacyPolicyLink] = React.useState< string >( "" );
    const [provider,setProvider]       = React.useState< Registration.CarrierProvider >( Registration.CarrierProvider.FAKE );
    const [areaCode,setAreaCode]       = React.useState< string >( "" );

    function keywords( csv : string ) : Array<string> { return csv.split( "," ).map( ( item : string ) : string => item.trim() ).filter( ( item : string ) : boolean => item.length > 0 ); }

    const ready : boolean = description.trim().length >= 40 && messageFlow.trim().length >= 40 &&
        sample1.trim().length >= 20 && sample2.trim().length >= 20 && privacyPolicyLink.trim() !== "" &&
        optinMessage.trim() !== "" && helpMessage.trim() !== "" && optoutMessage.trim() !== "";

    ////////////////////////////////////////////////////////////////////////////////////////////
    function onYes() : Promise<boolean>
    {
        return props.onSave( {
            usecase, description: description.trim(), messageFlow: messageFlow.trim(),
            sample1: sample1.trim(), sample2: sample2.trim(),
            optin:  { keywords: keywords( optinKeywords ),  message: optinMessage.trim() },
            help:   { keywords: keywords( helpKeywords ),   message: helpMessage.trim() },
            optout: { keywords: keywords( optoutKeywords ), message: optoutMessage.trim() },
            subscriberOptin, subscriberOptout, subscriberHelp,
            embeddedLink: false, embeddedPhone: false, numberPool: false, ageGated: false,
            directLending: false, affiliateMarketing: false, autoRenewal: false,
            privacyPolicyLink: privacyPolicyLink.trim(), provider, areaCode: areaCode.trim() || undefined,
        } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    return  <DialogWindow id="registration-campaign-form" title={"Create a campaign"} yesLabel={"Create campaign"} cancelLabel={"Cancel"}
                          minWidth="md" ready={ ready } onYes={ onYes } onClose={ props.onClose }>
                <Stack spacing={ 2 } sx={{ pt: 1 }}>
                    <SelectInput id="campaign-usecase" label={"Use case"} value={ usecase }
                                choices={ SelectInput.enumToChoices( Registration.UseCase ) } onChange={ ( value : string ) : void => setUsecase( value as Registration.UseCase ) } />
                    <TextInput id="campaign-description" label={"Description"} value={ description } onChange={ setDescription } multiline maxRows={ 4 } fullWidth
                              placeHolder={"What this campaign sends and why (min 40 characters)"} />
                    <TextInput id="campaign-message-flow" label={"Message flow"} value={ messageFlow } onChange={ setMessageFlow } multiline maxRows={ 4 } fullWidth
                              placeHolder={"How a recipient ends up opted in (min 40 characters)"} />
                    <TextInput id="campaign-sample-1" label={"Sample message 1"} value={ sample1 } onChange={ setSample1 } fullWidth />
                    <TextInput id="campaign-sample-2" label={"Sample message 2"} value={ sample2 } onChange={ setSample2 } fullWidth />

                    <Divider />
                    <Typography variant="subtitle2" color="text.secondary">Compliance keywords + auto-replies</Typography>
                    <Stack direction="row" spacing={ 2 }>
                        <TextInput id="campaign-optin-keywords" label={"Opt-in keywords"} value={ optinKeywords } onChange={ setOptinKeywords } fullWidth />
                        <TextInput id="campaign-optin-message" label={"Opt-in reply"} value={ optinMessage } onChange={ setOptinMessage } fullWidth />
                    </Stack>
                    <Stack direction="row" spacing={ 2 }>
                        <TextInput id="campaign-help-keywords" label={"Help keywords"} value={ helpKeywords } onChange={ setHelpKeywords } fullWidth />
                        <TextInput id="campaign-help-message" label={"Help reply"} value={ helpMessage } onChange={ setHelpMessage } fullWidth />
                    </Stack>
                    <Stack direction="row" spacing={ 2 }>
                        <TextInput id="campaign-optout-keywords" label={"Opt-out keywords"} value={ optoutKeywords } onChange={ setOptoutKeywords } fullWidth />
                        <TextInput id="campaign-optout-message" label={"Opt-out reply"} value={ optoutMessage } onChange={ setOptoutMessage } fullWidth />
                    </Stack>
                    <Stack direction="row" spacing={ 1 }>
                        <SwitchInput id="campaign-subscriber-optin"  label={"Subscriber opt-in"}  value={ subscriberOptin }  onChange={ setSubscriberOptin } />
                        <SwitchInput id="campaign-subscriber-optout" label={"Subscriber opt-out"} value={ subscriberOptout } onChange={ setSubscriberOptout } />
                        <SwitchInput id="campaign-subscriber-help"   label={"Subscriber help"}    value={ subscriberHelp }   onChange={ setSubscriberHelp } />
                    </Stack>

                    <Divider />
                    <TextInput id="campaign-privacy-link" label={"Privacy policy URL"} value={ privacyPolicyLink } onChange={ setPrivacyPolicyLink } fullWidth />
                    <Stack direction="row" spacing={ 2 }>
                        <SelectInput id="campaign-provider" label={"Carrier"} value={ provider }
                                    choices={ SelectInput.enumToChoices( Registration.CarrierProvider ) } onChange={ ( value : string ) : void => setProvider( value as Registration.CarrierProvider ) } />
                        <TextInput id="campaign-area-code" label={"Preferred area code (optional)"} value={ areaCode } onChange={ setAreaCode } fullWidth />
                    </Stack>
                </Stack>
            </DialogWindow>;
}

export namespace CampaignFormDialog
{
    export interface Draft
    {
        usecase            : Registration.UseCase;
        description        : string;
        messageFlow        : string;
        sample1            : string;
        sample2            : string;
        optin              : Registration.ComplianceMessage;
        help               : Registration.ComplianceMessage;
        optout             : Registration.ComplianceMessage;
        subscriberOptin    : boolean;
        subscriberOptout   : boolean;
        subscriberHelp     : boolean;
        embeddedLink       : boolean;
        embeddedPhone      : boolean;
        numberPool         : boolean;
        ageGated           : boolean;
        directLending      : boolean;
        affiliateMarketing : boolean;
        autoRenewal        : boolean;
        privacyPolicyLink  : string;
        provider           : Registration.CarrierProvider;
        areaCode?          : string;
    }

    export interface Props
    {
        brandId : string;
        onSave  : ( draft : Draft ) => Promise<boolean>;
        onClose : () => void;
    }
}

export default CampaignFormDialog;
// eof
