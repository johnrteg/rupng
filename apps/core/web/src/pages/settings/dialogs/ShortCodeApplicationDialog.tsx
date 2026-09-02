//
import React from 'react';
import { JSX } from "react";

import { Stack, Typography } from "@mui/material";

import { PhoneNumber, Registration } from '@repo/api';

import DialogWindow from '@widgets/core/DialogWindow';
import TextInput     from '@widgets/core/TextInput';
import SelectInput   from '@widgets/core/SelectInput';

//
// ShortCodeApplicationDialog — request a short code (registration-4.x). No carrier exposes a self-serve
// short-code order api (verified — Telnyx/Bandwidth/Vonage all require a sales/ops-mediated application +
// 8-12+ week carrier certification), so this submits an APPLICATION for staff to progress, not an instant order.
//
export function ShortCodeApplicationDialog( props : ShortCodeApplicationDialog.Props ) : JSX.Element
{
    const [preference,setPreference] = React.useState< PhoneNumber.ShortCodePreference >( PhoneNumber.ShortCodePreference.RANDOM );
    const [vanityCode,setVanityCode] = React.useState< string >( "" );
    const [useCase,setUseCase]       = React.useState< string >( "" );
    const [campaignId,setCampaignId] = React.useState< string >( "" );

    const isVanity : boolean = preference === PhoneNumber.ShortCodePreference.VANITY;
    const ready : boolean = useCase.trim() !== "" && ( !isVanity || vanityCode.trim() !== "" );

    ////////////////////////////////////////////////////////////////////////////////////////////
    function onYes() : Promise<boolean>
    {
        return props.onSubmit( { preference, vanityCode: isVanity ? vanityCode.trim() : undefined, useCase: useCase.trim(), campaignId: campaignId || undefined } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    return  <DialogWindow id="registration-shortcode-application" title={"Request a short code"} yesLabel={"Submit request"} cancelLabel={"Cancel"}
                          minWidth="sm" ready={ ready } onYes={ onYes } onClose={ props.onClose }>
                <Stack spacing={ 2 } sx={{ pt: 1 }}>
                    <Typography variant="body2" color="text.secondary">
                        Short codes are provisioned through a carrier sales process (typically 8-12+ weeks). This
                        submits your request — our team will progress it and notify you as it advances.
                    </Typography>
                    <SelectInput id="shortcode-preference" label={"Preference"} value={ preference }
                                choices={ SelectInput.enumToChoices( PhoneNumber.ShortCodePreference ) } onChange={ ( value : string ) : void => setPreference( value as PhoneNumber.ShortCodePreference ) } />
                    { isVanity && <TextInput id="shortcode-vanity-code" label={"Requested digits"} value={ vanityCode } onChange={ setVanityCode } allNumeric fullWidth /> }
                    <TextInput id="shortcode-use-case" label={"Use case"} value={ useCase } onChange={ setUseCase } multiline maxRows={ 3 } fullWidth />
                    { props.campaigns.length > 0 &&
                        <SelectInput id="shortcode-campaign" label={"Campaign (optional)"} value={ campaignId }
                                    choices={ [ { value: "", label: "(none yet)" }, ...props.campaigns.map( ( campaign : Registration.Campaign ) : SelectInput.Choice => ( { value: campaign.campaignId ?? "", label: campaign.description.slice( 0, 60 ) } ) ) ] }
                                    onChange={ setCampaignId } /> }
                </Stack>
            </DialogWindow>;
}

export namespace ShortCodeApplicationDialog
{
    export interface Draft { preference : PhoneNumber.ShortCodePreference; vanityCode? : string; useCase : string; campaignId? : string; }

    export interface Props
    {
        campaigns : Array<Registration.Campaign>;
        onSubmit  : ( draft : Draft ) => Promise<boolean>;
        onClose   : () => void;
    }
}

export default ShortCodeApplicationDialog;
// eof
