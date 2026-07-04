//
import React from 'react';
import { JSX } from "react";

import { Alert, Box, Stack, Typography } from "@mui/material";
import ContentCopyOutlinedIcon from '@mui/icons-material/ContentCopyOutlined';
import CheckOutlinedIcon       from '@mui/icons-material/CheckOutlined';

import BrowserUtils from '@utils/BrowserUtils';

import DialogWindow from '@widgets/core/DialogWindow';
import ButtonIcon   from '@widgets/core/ButtonIcon';

//
// ApiKeySecretDialog — reveal a newly minted key's FULL secret (`rup_<keyId>.<secret>`) ONCE. It's never
// retrievable again, so the user must copy it now. A single "Done" action closes it. The parent owns whether
// it's shown (it holds the secret returned by the mint call and clears it on close).
//
export function ApiKeySecretDialog( props : ApiKeySecretDialog.Props ) : JSX.Element
{
    const [copied,setCopied] = React.useState< boolean >( false );

    ////////////////////////////////////////////////////////////////////////////////////////////
    // copy the secret to the clipboard + flip the button to a confirmed state briefly
    async function onCopy() : Promise<void>
    {
        const ok : boolean = await BrowserUtils.copyToClipboard( props.secret );
        if( ok ) { setCopied( true ); window.setTimeout( () => setCopied( false ), 2000 ); }
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    async function onYes() : Promise<boolean> { return true; }   // "Done" just closes (onClose fires)

    ////////////////////////////////////////////////////////////////////////////////////////////
    return  <DialogWindow id="settings-api-key-secret"
                          title={"API Key Created"}
                          yesLabel={"Done"}
                          minWidth="sm"
                          onYes={ onYes }
                          onClose={ props.onClose }>
                <Stack spacing={ 2 } sx={{ p: 2 }}>
                    <Alert severity="warning" variant="outlined">
                        { "Copy this key now — it's shown only once and can't be retrieved again. Store it somewhere safe." }
                    </Alert>
                    <Typography variant="body2" sx={{ color: "text.secondary" }}>{ `Key "${ props.name }"` }</Typography>
                    <Box sx={{ display: "flex", alignItems: "center", gap: 1, p: 1.5, borderRadius: 1, bgcolor: "action.selected", border: 1, borderColor: "divider" }}>
                        <Typography variant="body2" sx={{ fontFamily: "monospace", wordBreak: "break-all", flexGrow: 1 }}>{ props.secret }</Typography>
                        <ButtonIcon id="api-key-copy"
                                    label={ copied ? "Copied" : "Copy" }
                                    icon={ copied ? <CheckOutlinedIcon fontSize="small" color="success" /> : <ContentCopyOutlinedIcon fontSize="small" /> }
                                    onClick={ () => void onCopy() } />
                    </Box>
                </Stack>
            </DialogWindow>;
}

export namespace ApiKeySecretDialog
{
    export interface Props
    {
        name    : string;     // the key's name, for context
        secret  : string;     // the full one-time `rup_<keyId>.<secret>` credential
        onClose : () => void;
    }
}

export default ApiKeySecretDialog;
// eof
