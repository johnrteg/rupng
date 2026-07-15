//
import React from 'react';
import { JSX } from "react";

import { Divider, Stack, Typography } from "@mui/material";

import { Account, PostSubAccount } from '@repo/api';

import DialogWindow      from '@widgets/core/DialogWindow';
import TextInput         from '@widgets/core/TextInput';
import CheckboxInput     from '@widgets/core/CheckboxInput';
import OrganizationInput from '@widgets/app/OrganizationInput';

//
// Add-sub-account dialog — collects the new account's name, organization (defaulted to the PARENT account's
// organization), and which parent fields to carry over (checkboxes; address today, more may follow). The
// parent owns whether the dialog is shown and performs the create via `onConfirm`; this component owns its
// form fields. `onConfirm` returns true on success (dialog closes). Carry-over is applied server-side from
// the parent — we only send the flags.
//
export function AddSubAccountDialog( props : AddSubAccountDialog.Props ) : JSX.Element
{
    const [name,setName]             = React.useState< string >( "" );
    const [orgType,setOrgType]       = React.useState< Account.OrganizationType >( props.parentOrganization?.type ?? Account.OrganizationType.OTHER );
    const [orgSubType,setOrgSubType] = React.useState< string >( props.parentOrganization?.subType ?? "" );
    const [carryAddress,setCarryAddress] = React.useState< boolean >( true );

    ////////////////////////////////////////////////////////////////////////////////////////////
    // create — defer to the parent with the trimmed name, organization, and carry-over flags
    async function onYes() : Promise<boolean>
    {
        const trimmed : string = name.trim();
        if( trimmed === "" ) return false;
        return props.onConfirm( {
            name:         trimmed,
            organization: { type: orgType, subType: orgSubType || undefined },
            carryOver:    { address: carryAddress },
        } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    return  <DialogWindow id="account-add-sub"
                          title={"Add a sub-account"}
                          yesLabel={"Create"}
                          cancelLabel={"Cancel"}
                          minWidth="xs"
                          ready={ name.trim() !== "" }
                          onYes={ onYes }
                          onClose={ props.onClose }>
                <Stack spacing={ 2 } sx={{ p: 2 }}>
                    <Typography variant="body2" sx={{ color: "text.secondary" }}>{"You'll be the owner and an admin of the new account."}</Typography>
                    <TextInput id="sub-name" label={"Account name"} value={ name } onChange={ ( value : string ) => setName( value ) } fullWidth />
                    <OrganizationInput id="sub-org"
                                       value={ { type: orgType, subType: orgSubType || undefined } }
                                       onChange={ ( org : Account.Organization ) => { setOrgType( org.type ); setOrgSubType( org.subType ?? "" ); } } />

                    <Divider />
                    <Typography variant="subtitle2">{"Carry over from this account"}</Typography>
                    <CheckboxInput id="sub-carry-address" label={"Address"} value={ carryAddress } onChange={ ( value : boolean ) => setCarryAddress( value ) } />
                </Stack>
            </DialogWindow>;
}

export namespace AddSubAccountDialog
{
    export interface Props
    {
        parentOrganization? : Account.Organization;   // seeds the org fields (default = same as parent)
        onConfirm           : ( input : { name : string; organization? : Account.Organization; carryOver? : PostSubAccount.CarryOver } ) => Promise<boolean>;
        onClose             : () => void;
    }
}

export default AddSubAccountDialog;
// eof
