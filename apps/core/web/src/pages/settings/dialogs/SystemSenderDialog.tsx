//
import React from 'react';
import { JSX } from "react";

import { Stack, Typography } from "@mui/material";

import { Email } from '@repo/api';

import DialogWindow from '@widgets/core/DialogWindow';
import TextInput    from '@widgets/core/TextInput';

//
// SystemSenderDialog — add or edit a platform outbound sender identity (an Email.Sender: key + email + name +
// purpose). The parent owns open/close + the upsert (`onSave`); this component owns the form state. On ADD the
// `key` is editable + must be unique; on EDIT it's fixed (routing references it).
//
export function SystemSenderDialog( props : SystemSenderDialog.Props ) : JSX.Element
{
    const isEdit : boolean = props.sender !== undefined;

    const [key,setKey]         = React.useState< string >( props.sender?.key ?? "" );
    const [email,setEmail]     = React.useState< string >( props.sender?.email ?? "" );
    const [name,setName]       = React.useState< string >( props.sender?.name ?? "" );
    const [purpose,setPurpose] = React.useState< string >( props.sender?.purpose ?? "" );

    // a new key must be non-empty + unique; on edit the key is locked so uniqueness is a given
    const keyOk : boolean = isEdit || ( key.trim() !== "" && !props.existingKeys.includes( key.trim() ) );
    const ready : boolean = keyOk && email.trim() !== "" && name.trim() !== "";

    ////////////////////////////////////////////////////////////////////////////////////////////
    // hand the parent the upserted sender; true closes the dialog
    async function onYes() : Promise<boolean>
    {
        if( !ready ) return false;
        props.onSave( { key: key.trim(), email: email.trim(), name: name.trim(), purpose: purpose.trim() || undefined } );
        return true;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    return  <DialogWindow id="settings-system-sender"
                          title={ isEdit ? "Edit sender" : "Add sender" }
                          yesLabel={ isEdit ? "Save" : "Add" }
                          cancelLabel={"Cancel"}
                          minWidth="sm"
                          ready={ ready }
                          onYes={ onYes }
                          onClose={ props.onClose }>
                <Stack spacing={ 2 } sx={{ p: 2 }}>
                    <Typography variant="body2" sx={{ color: "text.secondary" }}>
                        { "A named outbound identity for system mail. The key is a stable id (e.g. no-reply, security) referenced by routing; the address should be a verified sending identity." }
                    </Typography>
                    <TextInput id="sender-key" label={"Key"} value={ key } onChange={ setKey } readOnly={ isEdit } noSpaces maxLength={ 40 } fullWidth
                               placeHolder={"e.g. no-reply, security, billing"} />
                    <TextInput id="sender-email" label={"Email address"} value={ email } onChange={ setEmail } maxLength={ 200 } fullWidth
                               placeHolder={"no-reply@yourdomain.com"} />
                    <TextInput id="sender-name" label={"Display name"} value={ name } onChange={ setName } maxLength={ 100 } fullWidth
                               placeHolder={"Platform"} />
                    <TextInput id="sender-purpose" label={"Purpose (optional)"} value={ purpose } onChange={ setPurpose } maxLength={ 120 } fullWidth
                               placeHolder={"What this address is used for"} />
                </Stack>
            </DialogWindow>;
}

export namespace SystemSenderDialog
{
    export interface Props
    {
        sender?      : Email.Sender;            // present = edit; absent = add
        existingKeys : Array<string>;           // to enforce a unique key on add
        onSave       : ( sender : Email.Sender ) => void;
        onClose      : () => void;
    }
}

export default SystemSenderDialog;
// eof
