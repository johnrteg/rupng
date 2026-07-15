//
import React from 'react';
import { JSX } from "react";

import { Stack, Typography } from "@mui/material";

import { Account } from '@repo/api';

import DialogWindow from '@widgets/core/DialogWindow';
import SelectInput  from '@widgets/core/SelectInput';

//
// ChangeOwnerDialog — pick the member who becomes the account owner (transfer of ownership). Shown from the
// current owner's row. The parent owns whether it's open + performs the transfer via `onConfirm`; this
// component owns the selection. `onConfirm` returns true on success (dialog closes). `members` should already
// be the eligible set (active members who aren't the current owner).
//
export function ChangeOwnerDialog( props : ChangeOwnerDialog.Props ) : JSX.Element
{
    const [userId,setUserId] = React.useState< string >( "" );

    const choices : Array<SelectInput.Choice> = props.members.map( ( member : Account.Member ) =>
        ( { value: member.userId, label: member.name || member.email || member.userId } ) );
    const hasAdmins : boolean = choices.length > 0;

    ////////////////////////////////////////////////////////////////////////////////////////////
    async function onYes() : Promise<boolean>
    {
        if( userId === "" ) return false;
        return props.onConfirm( userId );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    return  <DialogWindow id="account-change-owner"
                          title={"Change Owner"}
                          yesLabel={"Change Owner"}
                          cancelLabel={"Cancel"}
                          minWidth="xs"
                          ready={ hasAdmins && userId !== "" }
                          onYes={ onYes }
                          onClose={ props.onClose }>
                <Stack spacing={ 2 } sx={{ p: 2 }}>
                    { hasAdmins
                        ? <>
                            <Typography variant="body2" sx={{ color: "text.secondary" }}>
                                { "Choose an account admin to become the owner. Only account admins are eligible; the current owner stays an admin." }
                            </Typography>
                            <SelectInput id="new-owner" label={"New owner"} value={ userId } choices={ choices } onChange={ ( value : string ) => setUserId( value ) } sx={{ width: "100%" }} />
                          </>
                        : <Typography variant="body2" sx={{ color: "text.secondary" }}>
                              { "There are no other account admins to transfer ownership to. Promote a member to Account Admin first, then change the owner." }
                          </Typography>
                    }
                </Stack>
            </DialogWindow>;
}

export namespace ChangeOwnerDialog
{
    export interface Props
    {
        members   : Array<Account.Member>;                       // eligible new owners (active, not the current owner)
        onConfirm : ( userId : string ) => Promise<boolean>;     // performs the transfer; true = success (dialog closes)
        onClose   : () => void;
    }
}

export default ChangeOwnerDialog;
// eof
