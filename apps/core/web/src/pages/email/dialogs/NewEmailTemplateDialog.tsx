//
import React from 'react';
import { JSX } from "react";

import { Stack, Typography } from "@mui/material";

import { EmailTemplate, Email } from '@repo/api';

import DialogWindow from '@widgets/core/DialogWindow';
import TextInput    from '@widgets/core/TextInput';
import SelectInput  from '@widgets/core/SelectInput';

//
// NewEmailTemplateDialog — name a new template + pick its scope and (optionally) the notification case it
// serves. The parent creates it (`onCreate`) and opens the editor; this component owns the form state.
//
export function NewEmailTemplateDialog( props : NewEmailTemplateDialog.Props ) : JSX.Element
{
    // when the parent LOCKS the scope (e.g. the Application-templates section forces SYSTEM), hide the picker
    const locked : boolean = props.fixedScope !== undefined;
    const isSystem : boolean = ( props.fixedScope ?? EmailTemplate.Scope.ACCOUNT ) === EmailTemplate.Scope.SYSTEM;

    const [name,setName]     = React.useState< string >( "" );
    const [scope,setScope]   = React.useState< string >( props.fixedScope ?? EmailTemplate.Scope.ACCOUNT );
    const [notif,setNotif]   = React.useState< string >( "" );

    const scopeChoices : Array<SelectInput.Choice> =
    [
        { value: EmailTemplate.Scope.ACCOUNT, label: "Account" },
        { value: EmailTemplate.Scope.SYSTEM,  label: "System (platform)" },
    ];
    // a SYSTEM/app template MUST serve an event; an account template can be a free (campaign) template
    const notifChoices : Array<SelectInput.Choice> = isSystem
        ? Object.values( Email.NotificationType ).map( ( value : Email.NotificationType ) : SelectInput.Choice => ( { value, label: value } ) )
        : [ { value: "", label: "(free template — no case)" }, ...Object.values( Email.NotificationType ).map( ( value : Email.NotificationType ) : SelectInput.Choice => ( { value, label: value } ) ) ];

    // ready when named + (for a system/app template) an event is chosen
    const ready : boolean = name.trim() !== "" && ( !isSystem || notif !== "" );

    ////////////////////////////////////////////////////////////////////////////////////////////
    async function onYes() : Promise<boolean>
    {
        const trimmed : string = name.trim();
        if( !ready ) return false;
        return props.onCreate( trimmed, scope as EmailTemplate.Scope, notif === "" ? undefined : ( notif as Email.NotificationType ) );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    return  <DialogWindow id="new-email-template"
                          title={ isSystem ? "New application template" : "New email template" }
                          yesLabel={"Create"}
                          cancelLabel={"Cancel"}
                          minWidth="sm"
                          ready={ ready }
                          onYes={ onYes }
                          onClose={ props.onClose }>
                <Stack spacing={ 2 } sx={{ p: 2 }}>
                    <Typography variant="body2" sx={{ color: "text.secondary" }}>
                        { isSystem
                            ? "Name the application template and pick the event it serves (verification, password reset, welcome, …). You'll design it in the editor next."
                            : "Name the template and (optionally) the notification it serves. You'll design it in the editor next." }
                    </Typography>
                    <TextInput id="tpl-name" label={"Name"} value={ name } onChange={ setName } maxLength={ 120 } fullWidth placeHolder={"e.g. Spring newsletter"} />
                    { !locked &&
                        <SelectInput id="tpl-scope" label={"Scope"} value={ scope } choices={ scopeChoices } onChange={ setScope } sx={{ width: "100%" }} /> }
                    <SelectInput id="tpl-notif" label={ isSystem ? "Event" : "Notification case" } value={ notif } choices={ notifChoices } onChange={ setNotif } sx={{ width: "100%" }} />
                </Stack>
            </DialogWindow>;
}

export namespace NewEmailTemplateDialog
{
    export interface Props
    {
        fixedScope? : EmailTemplate.Scope;   // when set, forces the scope + hides the picker (e.g. SYSTEM for app templates)
        onCreate    : ( name : string, scope : EmailTemplate.Scope, notificationType? : Email.NotificationType ) => Promise<boolean>;
        onClose     : () => void;
    }
}

export default NewEmailTemplateDialog;
// eof
