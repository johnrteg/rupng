import AppModel from "@model/AppModel";
//
import React from 'react';
import { JSX } from "react";

import { GetCampaigns, Campaign } from '@repo/api';
import { RestfulService } from '@repo/endpoint';

import SelectMultInput from '@widgets/core/SelectMultInput';

//
// CampaignSelect — a reusable multi-select of the account's (non-archived) campaigns, by id. Loads campaigns
// itself on mount; the parent owns the selected `value` (campaignIds) + `onChange`. Used wherever media is
// filed into 0..N campaigns (the library "Campaigns" action, the AI-gen accept dialog).
//
export function CampaignSelect( props : CampaignSelect.Props ) : JSX.Element
{
    const appmodel : AppModel = AppModel.instance();

    const [campaigns,setCampaigns] = React.useState< Array<Campaign.Entity> >( [] );

    ////////////////////////////////////////////////////////////////////////////////////////////
    React.useEffect( () => { void load(); }, [] );

    ////////////////////////////////////////////////////////////////////////////////////////////
    // load the account's campaigns (first page is plenty for a picker)
    async function load() : Promise<void>
    {
        const reply : RestfulService.Reply<GetCampaigns.Response> = await appmodel.server.fetch( new GetCampaigns() );
        if( reply.ok && reply.data ) setCampaigns( reply.data.records );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // campaign choices (exclude archived — they can't take new media)
    const choices : Array<SelectMultInput.Choice> = campaigns
        .filter( ( campaign : Campaign.Entity ) : boolean => campaign.status !== Campaign.Status.ARCHIVED )
        .map( ( campaign : Campaign.Entity ) : SelectMultInput.Choice => ( { value: campaign.id, label: campaign.name } ) );

    return  <SelectMultInput id={ props.id ?? "campaign-select" } label={ props.label ?? "Campaigns" }
                             value={ props.value } choices={ choices } onChange={ props.onChange } minWidth="100%" />;
}

export namespace CampaignSelect
{
    export interface Props
    {
        value     : Array<string>;                       // selected campaign ids
        onChange  : ( ids : Array<string> ) => void;
        id?       : string;
        label?    : string;
    }
}

export default CampaignSelect;
