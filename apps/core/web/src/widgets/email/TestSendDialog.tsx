//
import React from 'react';
import { JSX } from "react";

import { Stack, Typography } from "@mui/material";

import DialogWindow from '@widgets/core/DialogWindow';
import EmailInput   from '@widgets/core/EmailInput';

//
// TestSendDialog — collects a single recipient address and fires a TEST send of the CURRENT template (compiled
// with sample merge data). The parent owns the actual send (compile → PostEmailSend) via onSend; this dialog only
// gathers + validates the address. Built on the house DialogWindow (no click-outside dismissal).
//
export function TestSendDialog( props : TestSendDialog.Props ) : JSX.Element
{
    const [email,setEmail] = React.useState< string >( "" );

    // a light validity check to gate the Send button (the server does the authoritative validation)
    const valid : boolean = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test( email.trim() );

    // hand the address to the parent to compile + send; keep the dialog open on failure so the user can retry
    async function onSend() : Promise<boolean> { return valid ? props.onSend( email.trim() ) : false; }

    ////////////////////////////////////////////////////////////////////////////////////////////
    return <DialogWindow id="tpl-test-send" title={"Send a test"} minWidth="xs" yesLabel={"Send test"} cancelLabel={"Cancel"}
                         ready={ valid } onYes={ onSend } onClose={ props.onClose }>
        <Stack spacing={ 2 } sx={{ p: 2 }}>
            <Typography variant="body2" sx={{ color: "text.secondary" }}>{"Send the current design (with sample data) to an address so you can check it in a real inbox."}</Typography>
            <EmailInput id="test-send-email" label={"Recipient email"} value={ email } focus onChange={ setEmail } />
        </Stack>
    </DialogWindow>;
}

export namespace TestSendDialog
{
    export interface Props
    {
        onSend  : ( email : string ) => Promise<boolean>;   // compile + send; return whether it was accepted
        onClose : () => void;
    }
}

export default TestSendDialog;
// eof
