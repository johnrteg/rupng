import AppModel from "@model/AppModel";
//
import React from 'react';
import { JSX } from "react";

import { Stack, Typography } from "@mui/material";

import { Media, MediaConfig, PostAssetCompress } from '@repo/api';
import { RestfulService } from '@repo/endpoint';

import DialogWindow from '@widgets/core/DialogWindow';
import SelectInput  from '@widgets/core/SelectInput';

//
// MediaCompressDialog — pick a distribution target and compress a video (media-10.10). Async: enqueues the
// media-video Job; the compressed variant appears on the asset when the job completes. The parent owns
// open/close + the asset; this owns the target selection + the request.
//
export function MediaCompressDialog( props : MediaCompressDialog.Props ) : JSX.Element
{
    const appmodel : AppModel = AppModel.instance();

    // target choices from the seeded config (the Console can add/edit more)
    const choices : Array<SelectInput.Choice> = Object.entries( MediaConfig.DEFAULT.videoTargets )
        .map( ( [ value, target ] ) => ( { value, label: target.label } ) );

    const [target,setTarget] = React.useState< string >( choices[ 0 ]?.value ?? "mms" );

    ////////////////////////////////////////////////////////////////////////////////////////////
    async function onCompress() : Promise<boolean>
    {
        const reply : RestfulService.Reply<PostAssetCompress.Response> = await appmodel.server.fetch( new PostAssetCompress( props.asset.guid, { target } ) );
        return props.onDone( reply.ok );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    return  <DialogWindow id="media-compress"
                          title={"Compress video"}
                          yesLabel={"Compress"}
                          cancelLabel={"Cancel"}
                          minWidth="sm"
                          ready={ target !== "" }
                          onYes={ onCompress }
                          onClose={ props.onClose }>
                <Stack spacing={ 2 } sx={{ p: 2 }}>
                    <Typography variant="body2" sx={{ color: "text.secondary" }}>
                        {"Choose a distribution target. Compression runs in the background and adds a compressed variant to this video."}
                    </Typography>
                    <SelectInput id="compress-target" label={"Target"} value={ target } choices={ choices } onChange={ setTarget } sx={{ width: 260 }} />
                </Stack>
            </DialogWindow>;
}

export namespace MediaCompressDialog
{
    export interface Props
    {
        asset   : Media.Asset;
        onDone  : ( ok : boolean ) => boolean;   // report result to parent; return true to close
        onClose : () => void;
    }
}

export default MediaCompressDialog;
// eof
