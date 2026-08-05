//
import React from 'react';
import { JSX } from "react";

import { Stack, Typography } from "@mui/material";

import { EmailUtils } from '@repo/common';
import { Email } from '@repo/api';

import DialogWindow from '@widgets/core/DialogWindow';
import EmailInput    from '@widgets/core/EmailInput';
import TextInput     from '@widgets/core/TextInput';

//
// EmailSenderDialog — edit the FROM and REPLY-TO overrides saved with a template (email-2). Either address is
// optional and independent: leaving an email blank clears that override (the send falls back to the request's
// override, else the account/system default sender). A NAME is only meaningful alongside its email.
//
export function EmailSenderDialog( props : EmailSenderDialog.Props ) : JSX.Element
{
    const [fromEmail,setFromEmail]       = React.useState< string >( props.from?.email ?? "" );
    const [fromName,setFromName]         = React.useState< string >( props.from?.name ?? "" );
    const [replyToEmail,setReplyToEmail] = React.useState< string >( props.replyTo?.email ?? "" );
    const [replyToName,setReplyToName]   = React.useState< string >( props.replyTo?.name ?? "" );

    // each address is either blank (cleared) or a fully valid email — never a half-typed value
    const fromValid : boolean    = fromEmail.trim() === "" || EmailUtils.isValid( fromEmail.trim() );
    const replyToValid : boolean = replyToEmail.trim() === "" || EmailUtils.isValid( replyToEmail.trim() );
    const ready : boolean = fromValid && replyToValid;

    ////////////////////////////////////////////////////////////////////////////////////////////
    // hand the two overrides to the parent — "" clears a previously-saved address (server-side sentinel)
    async function onSave() : Promise<boolean>
    {
        if( !ready ) return false;
        const from : Email.Address | "" = fromEmail.trim() === "" ? "" : { email: fromEmail.trim(), name: fromName.trim() || undefined };
        const replyTo : Email.Address | "" = replyToEmail.trim() === "" ? "" : { email: replyToEmail.trim(), name: replyToName.trim() || undefined };
        return props.onSave( from, replyTo );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    return <DialogWindow id="tpl-sender" title={"From & reply-to"} minWidth="xs" yesLabel={"Save"} cancelLabel={"Cancel"}
                         ready={ ready } onYes={ onSave } onClose={ props.onClose }>
        <Stack spacing={ 2 } sx={{ p: 2 }}>
            <Typography variant="body2" sx={{ color: "text.secondary" }}>{"Override the sending identity and reply-to address for this template. Leave blank to use the account default."}</Typography>
            <EmailInput id="tpl-sender-from-email" label={"From email"} value={ fromEmail } onChange={ setFromEmail } />
            <TextInput  id="tpl-sender-from-name" label={"From name"} value={ fromName } disabled={ fromEmail.trim() === "" } onChange={ setFromName } />
            <EmailInput id="tpl-sender-replyto-email" label={"Reply-to email"} value={ replyToEmail } onChange={ setReplyToEmail } />
            <TextInput  id="tpl-sender-replyto-name" label={"Reply-to name"} value={ replyToName } disabled={ replyToEmail.trim() === "" } onChange={ setReplyToName } />
        </Stack>
    </DialogWindow>;
}

export namespace EmailSenderDialog
{
    export interface Props
    {
        from?    : Email.Address;
        replyTo? : Email.Address;
        onSave   : ( from : Email.Address | "", replyTo : Email.Address | "" ) => Promise<boolean>;
        onClose  : () => void;
    }
}

export default EmailSenderDialog;
// eof
