import AppModel from "@model/AppModel";
//
import React from 'react';
import { JSX } from "react";

import { Stack, Typography } from "@mui/material";

import { GetMembers, Account } from '@repo/api';
import { RestfulService } from '@repo/endpoint';

import DialogWindow from '@widgets/core/DialogWindow';
import SelectInput  from '@widgets/core/SelectInput';

//
// NewDmDialog — pick another account member to start a DM with. The parent opens (or finds) the room via
// `onStart` (true on success closes the dialog).
//
// KNOWN GAP: the member picker reads GetMembers, which is ACCOUNT-admin-gated — a non-admin user opening this
// dialog will see an empty list today. There's no lower-privilege "list my account's teammates" read yet;
// flagged rather than silently shipped as if it worked for everyone.
//
export function NewDmDialog( props : NewDmDialog.Props ) : JSX.Element
{
    const appmodel : AppModel = AppModel.instance();

    const [members,setMembers] = React.useState< Array<Account.Member> >( [] );
    const [userId,setUserId]   = React.useState< string >( "" );

    ////////////////////////////////////////////////////////////////////////////////////////////
    React.useEffect( componentLoaded, [] );
    function componentLoaded() : void { void load(); }

    async function load() : Promise<void>
    {
        const reply : RestfulService.Reply<GetMembers.Response> = await appmodel.server.fetch( new GetMembers( { count: 100 } ) );
        if( reply.ok && reply.data ) setMembers( reply.data.records.filter( ( member : Account.Member ) : boolean => member.userId !== props.excludeUserId ) );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    async function onYes() : Promise<boolean>
    {
        if( userId === "" ) return false;
        return props.onStart( userId );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    const choices : Array<SelectInput.Choice> = members.map( ( member : Account.Member ) : SelectInput.Choice => ( { value: member.userId, label: member.name ?? member.email ?? member.userId } ) );

    return  <DialogWindow id="chat-new-dm"
                          title={"New direct message"}
                          yesLabel={"Start"}
                          cancelLabel={"Cancel"}
                          minWidth="sm"
                          ready={ userId !== "" }
                          onYes={ onYes }
                          onClose={ props.onClose }>
                <Stack spacing={ 2 } sx={{ p: 2 }}>
                    { choices.length === 0
                        ? <Typography variant="body2" sx={{ color: "text.secondary" }}>{"No other teammates found."}</Typography>
                        : <SelectInput id="chat-new-dm-user" label={"Teammate"} value={ userId } choices={ choices } onChange={ setUserId } sx={{ width: "100%" }} /> }
                </Stack>
            </DialogWindow>;
}

export namespace NewDmDialog
{
    export interface Props
    {
        excludeUserId : string;                              // never let the caller pick themselves
        onStart       : ( userId : string ) => Promise<boolean>;
        onClose       : () => void;
    }
}

export default NewDmDialog;
// eof
