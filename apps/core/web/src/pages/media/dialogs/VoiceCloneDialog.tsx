import AppModel from "@model/AppModel";
//
import React from 'react';
import { JSX } from "react";

import { Stack, Typography } from "@mui/material";

import { Media, PostVoiceClone } from '@repo/api';
import { RestfulService } from '@repo/endpoint';

import DialogWindow from '@widgets/core/DialogWindow';
import TextInput    from '@widgets/core/TextInput';

//
// VoiceCloneDialog — clone a reusable voice from an AUDIO asset (media-21). The cloned voice is ACCOUNT-scoped
// (never shared across accounts) and can then be picked in AI Gen → Voice. The parent owns open/close + the
// source asset; this owns the name + the request.
//
export function VoiceCloneDialog( props : VoiceCloneDialog.Props ) : JSX.Element
{
    const appmodel : AppModel = AppModel.instance();

    const [name,setName] = React.useState< string >( `${ props.asset.name } voice` );

    ////////////////////////////////////////////////////////////////////////////////////////////
    async function onClone() : Promise<boolean>
    {
        if( name.trim() === "" ) return false;
        const reply : RestfulService.Reply<PostVoiceClone.Response> = await appmodel.server.fetch(
            new PostVoiceClone( { sourceGuid: props.asset.guid, name: name.trim() } ) );
        return props.onDone( reply.ok );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    return  <DialogWindow id="voice-clone"
                          title={"Clone voice"}
                          yesLabel={"Clone"}
                          cancelLabel={"Cancel"}
                          minWidth="sm"
                          ready={ name.trim() !== "" }
                          onYes={ onClone }
                          onClose={ props.onClose }>
                <Stack spacing={ 2 } sx={{ p: 2 }}>
                    <Typography variant="body2" sx={{ color: "text.secondary" }}>
                        {"Create a reusable voice from this audio. It stays private to your account and can be used in AI Gen → Voice."}
                    </Typography>
                    <TextInput id="voice-name" label={"Voice name"} value={ name } maxLength={ 120 } onChange={ setName } sx={{ width: "100%" }} />
                </Stack>
            </DialogWindow>;
}

export namespace VoiceCloneDialog
{
    export interface Props
    {
        asset   : Media.Asset;
        onDone  : ( ok : boolean ) => boolean;
        onClose : () => void;
    }
}

export default VoiceCloneDialog;
// eof
