//
import React from 'react';
import { JSX } from "react";

import { Stack, Typography } from "@mui/material";

import { Email, EmailConfig } from '@repo/api';

import DialogWindow from '@widgets/core/DialogWindow';
import TextInput    from '@widgets/core/TextInput';
import SelectInput  from '@widgets/core/SelectInput';
import SwitchInput  from '@widgets/core/SwitchInput';

//
// ProviderConfigDialog — add or edit one email provider's registry entry (`EmailConfig.ProviderEntry`): whether
// it's enabled, its Secrets Manager `secretRef` + region, and its OWN default from/reply-to send identity. The
// from/replyTo default matters because different providers under test (e.g. a Mailgun sandbox domain vs a
// verified SendGrid domain) each need their own sending identity — this is the fallback tier between a
// template's saved from/replyTo and the platform system-sender routing (see `EmailService.processSend`). The
// parent owns open/close + the upsert (`onSave`); this component owns the form state. On ADD the `provider` is
// editable + must be unique (not already configured); on EDIT it's fixed (it's the registry key).
//
export function ProviderConfigDialog( props : ProviderConfigDialog.Props ) : JSX.Element
{
    const isEdit : boolean = props.entry !== undefined;

    const [provider,setProvider]   = React.useState< Email.Provider | "" >( props.entry?.provider ?? "" );
    const [enabled,setEnabled]     = React.useState< boolean >( props.entry?.enabled ?? true );
    const [secretRef,setSecretRef] = React.useState< string >( props.entry?.secretRef ?? "" );
    const [region,setRegion]       = React.useState< string >( props.entry?.region ?? "" );
    const [fromEmail,setFromEmail] = React.useState< string >( props.entry?.from?.email ?? "" );
    const [fromName,setFromName]   = React.useState< string >( props.entry?.from?.name ?? "" );
    const [replyEmail,setReplyEmail] = React.useState< string >( props.entry?.replyTo?.email ?? "" );
    const [replyName,setReplyName]   = React.useState< string >( props.entry?.replyTo?.name ?? "" );

    // a new entry must pick a provider not already configured; on edit the provider is locked (it's the key)
    const providerOk : boolean = isEdit || ( provider !== "" && !props.existingProviders.includes( provider ) );
    const ready : boolean = providerOk && provider !== "";

    ////////////////////////////////////////////////////////////////////////////////////////////
    // hand the parent the upserted provider entry; true closes the dialog
    async function onYes() : Promise<boolean>
    {
        if( !ready || provider === "" ) return false;
        const entry : EmailConfig.ProviderEntry =
        {
            provider, enabled,
            secretRef: secretRef.trim() || undefined,
            region:    region.trim() || undefined,
            from:      fromEmail.trim() ? { email: fromEmail.trim(), name: fromName.trim() || undefined } : undefined,
            replyTo:   replyEmail.trim() ? { email: replyEmail.trim(), name: replyName.trim() || undefined } : undefined,
        };
        props.onSave( entry );
        return true;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    return  <DialogWindow id="settings-provider-config"
                          title={ isEdit ? "Edit provider" : "Add provider" }
                          yesLabel={ isEdit ? "Save" : "Add" }
                          cancelLabel={"Cancel"}
                          minWidth="sm"
                          ready={ ready }
                          onYes={ onYes }
                          onClose={ props.onClose }>
                <Stack spacing={ 2 } sx={{ p: 2 }}>
                    <Typography variant="body2" sx={{ color: "text.secondary" }}>
                        { "The from/reply-to here are THIS provider's own default send identity — useful when testing several providers side by side, each needing its own verified (or sandboxed) sending address. Leave blank to fall back to the platform system sender." }
                    </Typography>
                    <SelectInput id="provider-config-provider" label={"Provider"} value={ provider } readOnly={ isEdit }
                                 choices={ props.providerChoices } onChange={ ( value : string ) : void => setProvider( value as Email.Provider ) } sx={{ width: "100%" }} />
                    <SwitchInput id="provider-config-enabled" label={"Enabled"} value={ enabled } onChange={ setEnabled } />
                    <TextInput id="provider-config-secret-ref" label={"Secret ref (optional — overrides the registry default)"} value={ secretRef } onChange={ setSecretRef } maxLength={ 120 } fullWidth
                               placeHolder={"e.g. email-mailgun"} />
                    <TextInput id="provider-config-region" label={"Region (optional)"} value={ region } onChange={ setRegion } maxLength={ 40 } fullWidth
                               placeHolder={"e.g. us-east-1"} />
                    <Typography variant="subtitle2" sx={{ mt: 1 }}>{"Default from"}</Typography>
                    <TextInput id="provider-config-from-email" label={"From address (optional)"} value={ fromEmail } onChange={ setFromEmail } maxLength={ 200 } fullWidth
                               placeHolder={"e.g. postmaster@sandbox123.mailgun.org"} />
                    <TextInput id="provider-config-from-name" label={"From display name (optional)"} value={ fromName } onChange={ setFromName } maxLength={ 100 } fullWidth />
                    <Typography variant="subtitle2" sx={{ mt: 1 }}>{"Default reply-to"}</Typography>
                    <TextInput id="provider-config-reply-email" label={"Reply-to address (optional)"} value={ replyEmail } onChange={ setReplyEmail } maxLength={ 200 } fullWidth />
                    <TextInput id="provider-config-reply-name" label={"Reply-to display name (optional)"} value={ replyName } onChange={ setReplyName } maxLength={ 100 } fullWidth />
                </Stack>
            </DialogWindow>;
}

export namespace ProviderConfigDialog
{
    export interface Props
    {
        entry?           : EmailConfig.ProviderEntry;    // present = edit; absent = add
        existingProviders : Array<Email.Provider>;        // to enforce a unique provider on add
        providerChoices  : Array<SelectInput.Choice>;
        onSave           : ( entry : EmailConfig.ProviderEntry ) => void;
        onClose          : () => void;
    }
}

export default ProviderConfigDialog;
// eof
