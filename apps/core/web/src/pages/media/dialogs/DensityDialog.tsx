import AppModel from "@model/AppModel";
//
import React from 'react';
import { JSX } from "react";

import { Stack, Typography } from "@mui/material";

import { Media, GetDensities, PostAssetDensity } from '@repo/api';
import { RestfulService } from '@repo/endpoint';

import DialogWindow from '@widgets/core/DialogWindow';
import SelectInput  from '@widgets/core/SelectInput';

//
// DensityDialog — render an image to a configured DPI/density (media-4). Lists the service-configured density
// targets (Web 72, Print 300, …) via GetDensities and, on Apply, posts the chosen one (PostAssetDensity) which
// adds a `density.<key>` item. The parent owns open/close + performs the reload via onDone.
//
export function DensityDialog( props : DensityDialog.Props ) : JSX.Element
{
    const appmodel : AppModel = AppModel.instance();

    const [densities,setDensities] = React.useState< Array<GetDensities.Density> >( [] );
    const [choice,setChoice]       = React.useState< string >( "" );

    ////////////////////////////////////////////////////////////////////////////////////////////
    React.useEffect( () : void => { void loadDensities(); }, [] );

    ////////////////////////////////////////////////////////////////////////////////////////////
    // load the configured density targets; default the picker to the first
    async function loadDensities() : Promise<void>
    {
        const reply : RestfulService.Reply<GetDensities.Response> = await appmodel.server.fetch( new GetDensities() );
        if( reply.ok && reply.data )
        {
            setDensities( reply.data.densities );
            if( reply.data.densities.length > 0 ) setChoice( reply.data.densities[ 0 ].key );
        }
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // render the image at the chosen density → true on success (dialog closes)
    async function onApply() : Promise<boolean>
    {
        if( choice === "" ) return false;
        const reply : RestfulService.Reply<PostAssetDensity.Response> = await appmodel.server.fetch( new PostAssetDensity( props.asset.guid, { density: choice } ) );
        return props.onDone( reply.ok );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    const choices : Array<SelectInput.Choice> = densities.map( ( density : GetDensities.Density ) : SelectInput.Choice => ( { value: density.key, label: `${ density.label } (${ density.dpi } dpi)` } ) );

    ////////////////////////////////////////////////////////////////////////////////////////////
    return  <DialogWindow id="media-density"
                          title={"Change density"}
                          yesLabel={"Apply"}
                          cancelLabel={"Cancel"}
                          minWidth="sm"
                          ready={ choice !== "" }
                          onYes={ onApply }
                          onClose={ props.onClose }>
                <Stack spacing={ 2 } sx={{ p: 2 }}>
                    <Typography variant="body2" sx={{ color: "text.secondary" }}>{ `Render "${ props.asset.name }" to a target DPI — added as a new density item.` }</Typography>
                    { choices.length > 0
                        ? <SelectInput id="media-density-target" label={"Density"} value={ choice } choices={ choices } onChange={ setChoice } sx={{ width: 240 }} />
                        : <Typography variant="body2" sx={{ color: "text.secondary" }}>{"No density targets are configured."}</Typography> }
                </Stack>
            </DialogWindow>;
}

export namespace DensityDialog
{
    export interface Props
    {
        asset   : Media.Asset;
        onDone  : ( ok : boolean ) => boolean;   // report result to parent; return true to close
        onClose : () => void;
    }
}

export default DensityDialog;
// eof
