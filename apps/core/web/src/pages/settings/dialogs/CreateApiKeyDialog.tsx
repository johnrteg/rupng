//
import React from 'react';
import { JSX } from "react";

import { Stack, Typography } from "@mui/material";

import { Access } from '@repo/system';

import DialogWindow from '@widgets/core/DialogWindow';
import TextInput    from '@widgets/core/TextInput';
import SelectInput  from '@widgets/core/SelectInput';

//
// CreateApiKeyDialog — collect a new developer API key's name + max role (capped at the caller's own role) and
// an optional expiry. The parent owns open/close + performs the mint via `onCreate` (which returns true on
// success → the dialog closes and the parent reveals the one-time secret). This component owns the form state.
//
export function CreateApiKeyDialog( props : CreateApiKeyDialog.Props ) : JSX.Element
{
    const [name,setName]     = React.useState< string >( "" );
    const [role,setRole]     = React.useState< string >( props.callerRole );
    const [expiry,setExpiry] = React.useState< string >( CreateApiKeyDialog.EXPIRY_NEVER );

    // the assignable roles: the account ladder capped at the caller's own rank (can't mint a stronger key)
    const roleChoices : Array<SelectInput.Choice> = CreateApiKeyDialog.ROLE_CHOICES
        .filter( ( choice : SelectInput.Choice ) => Access.isAllowed( props.callerRole, choice.value as Access.Role ) );

    ////////////////////////////////////////////////////////////////////////////////////////////
    // mint on confirm — hand the parent the trimmed name, chosen role, and (if set) expiry-in-days
    async function onYes() : Promise<boolean>
    {
        const trimmedName : string = name.trim();
        if( trimmedName === "" ) return false;
        const expiresInDays : number | undefined = expiry === CreateApiKeyDialog.EXPIRY_NEVER ? undefined : Number( expiry );
        return props.onCreate( trimmedName, role as Access.Role, expiresInDays );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    return  <DialogWindow id="settings-create-api-key"
                          title={"Create API Key"}
                          yesLabel={"Create key"}
                          cancelLabel={"Cancel"}
                          minWidth="sm"
                          ready={ name.trim() !== "" && role !== "" }
                          onYes={ onYes }
                          onClose={ props.onClose }>
                <Stack spacing={ 2 } sx={{ p: 2 }}>
                    <Typography variant="body2" sx={{ color: "text.secondary" }}>
                        { "Name the key so you can recognize it later. Its role sets the maximum access a request made with this key can have — you can't create a key more powerful than your own role." }
                    </Typography>
                    <TextInput id="api-key-name" label={"Name"} value={ name } onChange={ setName } maxLength={ 100 } fullWidth
                               placeHolder={"e.g. Production server, Zapier integration"} />
                    <SelectInput id="api-key-role" label={"Max role"} value={ role } choices={ roleChoices } onChange={ setRole } sx={{ width: "100%" }} />
                    <SelectInput id="api-key-expiry" label={"Expires"} value={ expiry } choices={ CreateApiKeyDialog.EXPIRY_CHOICES } onChange={ setExpiry } sx={{ width: "100%" }} />
                </Stack>
            </DialogWindow>;
}

export namespace CreateApiKeyDialog
{
    export const EXPIRY_NEVER : string = "never";

    /** Account-ladder roles a key can carry (MINIMUM omitted — a no-access key is pointless), least→most privileged. */
    export const ROLE_CHOICES : Array<SelectInput.Choice> =
    [
        { value: Access.AccountRole.SENDER,  label: "Sender" },
        { value: Access.AccountRole.USER,    label: "User" },
        { value: Access.AccountRole.BILLING, label: "Billing" },
        { value: Access.AccountRole.ACCOUNT, label: "Account Admin" },
    ];

    /** Optional key lifetime (value is a day count, or the sentinel "never" for a non-expiring key). */
    export const EXPIRY_CHOICES : Array<SelectInput.Choice> =
    [
        { value: EXPIRY_NEVER, label: "Never" },
        { value: "30",         label: "30 days" },
        { value: "90",         label: "90 days" },
        { value: "365",        label: "1 year" },
    ];

    export interface Props
    {
        callerRole : Access.Role;                                                                    // caps the role choices
        onCreate   : ( name : string, role : Access.Role, expiresInDays? : number ) => Promise<boolean>;  // mint; true = close + reveal
        onClose    : () => void;
    }
}

export default CreateApiKeyDialog;
// eof
