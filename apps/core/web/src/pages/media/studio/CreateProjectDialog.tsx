import AppModel from "@model/AppModel";
//
import React from 'react';
import { JSX } from "react";

import { Stack } from "@mui/material";

import { Media, GetCampaigns, Campaign } from '@repo/api';
import { RestfulService } from '@repo/endpoint';

import DialogWindow from '@widgets/core/DialogWindow';
import TextInput    from '@widgets/core/TextInput';
import SelectInput  from '@widgets/core/SelectInput';

//
// CreateProjectDialog — start a new Studio project: a name, a media type (image / video / audio), and the
// CAMPAIGN it belongs to (so the studio can group/cascade projects by campaign). The parent owns open/close +
// creation (`onCreate` returns true to close). Dialog owns its form state; it loads the account's campaigns.
//
export function CreateProjectDialog( props : CreateProjectDialog.Props ) : JSX.Element
{
    const appmodel : AppModel = AppModel.instance();

    const [name,setName]           = React.useState< string >( "" );
    const [type,setType]           = React.useState< string >( Media.Kind.IMAGE );
    const [campaignId,setCampaign] = React.useState< string >( props.defaultCampaignId ?? "" );   // defaulted when opened from a campaign row
    const [campaigns,setCampaigns] = React.useState< Array<Campaign.Entity> >( [] );

    ////////////////////////////////////////////////////////////////////////////////////////////
    React.useEffect( () => { void loadCampaigns(); }, [] );

    // load the account's (non-archived) campaigns for the picker
    async function loadCampaigns() : Promise<void>
    {
        const reply : RestfulService.Reply<GetCampaigns.Response> = await appmodel.server.fetch( new GetCampaigns() );
        if( reply.ok && reply.data ) setCampaigns( reply.data.records );
    }

    // campaign choices — a "(no campaign)" first, then the account's active campaigns by name
    const campaignChoices : Array<SelectInput.Choice> = [ { value: "", label: "(No campaign)" }, ...campaigns
        .filter( ( campaign : Campaign.Entity ) : boolean => campaign.status !== Campaign.Status.ARCHIVED )
        .map( ( campaign : Campaign.Entity ) : SelectInput.Choice => ( { value: campaign.id, label: campaign.name } ) ) ];

    ////////////////////////////////////////////////////////////////////////////////////////////
    // create on confirm — name + type + the chosen campaign (empty = unassigned)
    async function onYes() : Promise<boolean>
    {
        const trimmed : string = name.trim();
        if( trimmed === "" ) return false;
        return props.onCreate( trimmed, type as Media.Kind, campaignId || undefined );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    return  <DialogWindow id="studio-create-project"
                          title={"New Project"}
                          yesLabel={"Create"}
                          cancelLabel={"Cancel"}
                          minWidth="xs"
                          ready={ name.trim() !== "" }
                          onYes={ onYes }
                          onClose={ props.onClose }>
                <Stack spacing={ 2 } sx={{ p: 2 }}>
                    <TextInput id="project-name" label={"Name"} value={ name } onChange={ setName } maxLength={ 100 } fullWidth
                               placeHolder={"e.g. Spring promo spot"} />
                    <SelectInput id="project-type" label={"Type"} value={ type } choices={ CreateProjectDialog.TYPE_CHOICES } onChange={ setType } sx={{ width: "100%" }} />
                    <SelectInput id="project-campaign" label={"Campaign"} value={ campaignId } choices={ campaignChoices } onChange={ setCampaign } sx={{ width: "100%" }} />
                </Stack>
            </DialogWindow>;
}

export namespace CreateProjectDialog
{
    /** The media types a Studio project can target. */
    export const TYPE_CHOICES : Array<SelectInput.Choice> =
    [
        { value: Media.Kind.IMAGE, label: "Image" },
        { value: Media.Kind.VIDEO, label: "Video" },
        { value: Media.Kind.AUDIO, label: "Audio" },
    ];

    export interface Props
    {
        defaultCampaignId? : string;   // pre-select this campaign (e.g. opened from a campaign row's add button)
        onCreate : ( name : string, type : Media.Kind, campaignId? : string ) => Promise<boolean>;   // create; true = close
        onClose  : () => void;
    }
}

export default CreateProjectDialog;
// eof
