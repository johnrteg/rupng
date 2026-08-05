//
import React from 'react';
import { JSX } from "react";

//
import { Stack } from '@mui/material';

//
import { EmailUtils } from '@repo/common';

import DialogWindow         from "@widgets/core/DialogWindow";
import EmailInput           from "@widgets/core/EmailInput";
import TextInput            from "@widgets/core/TextInput";

//
// EmailLinkEditor — the RTE's "Email link" tool: same shape as LinkEditor (text + a value field), but the
// value is a bare email address, validated + saved as a mailto: link rather than an http(s) URL.
//
export function EmailLinkEditor( props : EmailLinkEditor.Props ) : JSX.Element
{
    const [text,setText]   = React.useState< string >( props.value ? props.value : "" );
    const [email,setEmail] = React.useState< string >( "" );

    /////////////////////////////////////////////////////////////////////////////////////////////////////
    async function onSave() : Promise<boolean>
    {
        return true;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////////////
    function onSaved() : void
    {
        props.onSaved( text, email );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////////////
    function isReady() : boolean
    {
        return text.length > 2 && EmailUtils.isValid( email );
    }

    // ==================================================================================================
    return  <DialogWindow   id="rte-email-link"
                            title={ "Email Link Editor" }
                            cancelLabel={"Cancel"}
                            yesLabel={"Save"}
                            ready={ isReady() }
                            onYes={ onSave }
                            onClose={ props.onClose }
                            onSaved={ onSaved } >

                <Stack direction="column" spacing={ 2 } sx={ { p : 2 } } >

                    <TextInput  id="text"
                                label={ "Text" }
                                value={ text }
                                onChange={ setText } />

                    <EmailInput id="email"
                                label={ "Email address" }
                                value={ email }
                                onChange={ setEmail } />

                </Stack>

            </DialogWindow>;

}

export namespace EmailLinkEditor
{
    export interface Props
    {
        value?      : string;
        onClose     : () => void;
        onSaved     : ( text: string, email : string ) => void;
    }
}

export default EmailLinkEditor;

// eof
