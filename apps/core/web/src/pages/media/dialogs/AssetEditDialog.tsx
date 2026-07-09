import AppModel from "@model/AppModel";
//
import React from 'react';
import { JSX } from "react";

import { Stack } from "@mui/material";

import { Media, PatchAsset } from '@repo/api';
import { RestfulService } from '@repo/endpoint';

import DialogWindow   from '@widgets/core/DialogWindow';
import TextInput      from '@widgets/core/TextInput';
import TagInput       from '@widgets/core/TagInput';
import CampaignSelect from '@widgets/app/CampaignSelect';

//
// AssetEditDialog — edit a media asset's display name, tags, and the campaigns it belongs to (PatchAsset). The
// parent owns open/close and passes the asset in; this dialog owns its own form state and performs the
// mutation, returning success to the parent so it can snack + reload.
//
export function AssetEditDialog( props : AssetEditDialog.Props ) : JSX.Element
{
    const appmodel : AppModel = AppModel.instance();

    const [name,setName]           = React.useState< string >( props.asset.name );
    const [tags,setTags]           = React.useState< Array<string> >( props.asset.tags ?? [] );
    const [campaignIds,setCampaigns] = React.useState< Array<string> >( props.asset.campaignIds ?? [] );

    ////////////////////////////////////////////////////////////////////////////////////////////
    // save name + tags + campaigns → true on success (dialog closes)
    async function onSave() : Promise<boolean>
    {
        if( name.trim() === "" ) return false;
        const reply : RestfulService.Reply<PatchAsset.Response> = await appmodel.server.fetch( new PatchAsset( props.asset.guid, { name: name.trim(), tags, campaignIds } ) );
        return props.onSaved( reply.ok, reply.ok && reply.data ? reply.data.asset : undefined );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    return  <DialogWindow id="media-asset-edit"
                          title={"Edit media"}
                          yesLabel={"Save"}
                          cancelLabel={"Cancel"}
                          minWidth="sm"
                          ready={ name.trim() !== "" }
                          onYes={ onSave }
                          onClose={ props.onClose }>
                <Stack spacing={ 2 } sx={{ p: 2 }}>
                    <TextInput id="media-name" label={"Name"} value={ name } maxLength={ 300 } onChange={ setName } sx={{ width: "100%" }} />
                    <TagInput id="media-tags" label={"Tags"} value={ tags } choices={ [] } onChange={ setTags } />
                    <CampaignSelect value={ campaignIds } onChange={ setCampaigns } label={"Campaigns"} />
                </Stack>
            </DialogWindow>;
}

export namespace AssetEditDialog
{
    export interface Props
    {
        asset    : Media.Asset;
        onSaved  : ( ok : boolean, asset? : Media.Asset ) => boolean;   // report result to parent; return true to close
        onClose  : () => void;
    }
}

export default AssetEditDialog;
// eof
