//
import React from 'react';
import { JSX } from "react";

import { Stack } from "@mui/material";

import { Collab } from '@repo/api';

import DialogWindow from '@widgets/core/DialogWindow';
import TextInput    from '@widgets/core/TextInput';
import SelectInput  from '@widgets/core/SelectInput';

//
// CreateChannelDialog — collect a new channel's name + visibility. The parent performs the create via
// `onCreate` (true on success closes the dialog). This component owns the form state only.
//
export function CreateChannelDialog( props : CreateChannelDialog.Props ) : JSX.Element
{
    const [name,setName]             = React.useState< string >( "" );
    const [visibility,setVisibility] = React.useState< Collab.Visibility >( Collab.Visibility.PUBLIC );

    ////////////////////////////////////////////////////////////////////////////////////////////
    async function onYes() : Promise<boolean>
    {
        const trimmedName : string = name.trim();
        if( trimmedName === "" ) return false;
        return props.onCreate( trimmedName, visibility );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    return  <DialogWindow id="chat-create-channel"
                          title={"Create channel"}
                          yesLabel={"Create"}
                          cancelLabel={"Cancel"}
                          minWidth="sm"
                          ready={ name.trim() !== "" }
                          onYes={ onYes }
                          onClose={ props.onClose }>
                <Stack spacing={ 2 } sx={{ p: 2 }}>
                    <TextInput id="chat-channel-name" label={"Channel name"} value={ name } onChange={ setName } maxLength={ 80 } fullWidth
                               placeHolder={"e.g. general, product-team"} />
                    <SelectInput id="chat-channel-visibility" label={"Visibility"} value={ visibility } sx={{ width: "100%" }}
                                 choices={ CreateChannelDialog.VISIBILITY_CHOICES } onChange={ ( value : string ) : void => setVisibility( value as Collab.Visibility ) } />
                </Stack>
            </DialogWindow>;
}

export namespace CreateChannelDialog
{
    export const VISIBILITY_CHOICES : Array<SelectInput.Choice> =
    [
        { value: Collab.Visibility.PUBLIC,  label: "Public — anyone on this account can join" },
        { value: Collab.Visibility.PRIVATE, label: "Private — invite only" },
    ];

    export interface Props
    {
        onCreate : ( name : string, visibility : Collab.Visibility ) => Promise<boolean>;
        onClose  : () => void;
    }
}

export default CreateChannelDialog;
// eof
