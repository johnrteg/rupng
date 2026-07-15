//
import React from 'react';
import { JSX } from "react";

import { Stack } from "@mui/material";

import { Campaign } from '@repo/api';

import DialogWindow    from '@widgets/core/DialogWindow';
import TextInput       from '@widgets/core/TextInput';
import SelectMultInput from '@widgets/core/SelectMultInput';

//
// CampaignCreateDialog — create a campaign (draft). The parent owns open/close + does the POST via onCreate;
// this dialog owns its form state. First cut: name + objective + which channels to enable (each seeded with a
// default blast strategy + no plans yet). The strategy/plan editor comes later.
//
export function CampaignCreateDialog( props : CampaignCreateDialog.Props ) : JSX.Element
{
    const [name,setName]           = React.useState< string >( "" );
    const [objective,setObjective] = React.useState< string >( "" );
    const [channels,setChannels]   = React.useState< Array<string> >( [] );

    // channel picker choices — straight off the model enum (single source)
    const channelChoices : Array<SelectMultInput.Choice> = Object.values( Campaign.Channel )
        .map( ( channel : Campaign.Channel ) : SelectMultInput.Choice => ( { value: channel, label: channel } ) );

    ////////////////////////////////////////////////////////////////////////////////////////////
    // seed a default channel config for each picked channel (enabled, a blast strategy, no plans yet)
    function toChannelConfigs() : Array<Campaign.ChannelConfig>
    {
        return channels.map( ( channel : string ) : Campaign.ChannelConfig => ( {
            channel:  channel as Campaign.Channel,
            enabled:  true,
            strategy: { cadence: Campaign.Cadence.BLAST },
            plans:    [],
        } ) );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    function onYes() : Promise<boolean>
    {
        return props.onCreate( {
            name:      name.trim(),
            objective: objective.trim() || undefined,
            channels:  toChannelConfigs(),
        } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    return  <DialogWindow id="campaign-create"
                          title={"Create campaign"}
                          yesLabel={"Create campaign"}
                          cancelLabel={"Cancel"}
                          minWidth="sm"
                          ready={ name.trim() !== "" }
                          onYes={ onYes }
                          onClose={ props.onClose }>
                <Stack spacing={ 2 } sx={{ p: 2 }}>
                    <TextInput id="campaign-name" label={"Name"} value={ name } onChange={ setName } maxLength={ 140 } fullWidth
                               placeHolder={"e.g. Summer Sale Blast"} />
                    <TextInput id="campaign-objective" label={"Objective"} value={ objective } onChange={ setObjective } maxLength={ 500 } fullWidth
                               placeHolder={"What this campaign is trying to achieve"} />
                    <SelectMultInput id="campaign-channels" label={"Channels"} value={ channels } choices={ channelChoices } onChange={ setChannels } minWidth="100%" />
                </Stack>
            </DialogWindow>;
}

export namespace CampaignCreateDialog
{
    export interface Props
    {
        onCreate : ( campaign : Campaign.CreateCampaign ) => Promise<boolean>;
        onClose  : () => void;
    }
}

export default CampaignCreateDialog;
