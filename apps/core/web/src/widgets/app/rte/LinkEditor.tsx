//
import React from 'react';
import { JSX } from "react";

//
import { Stack } from '@mui/material';

// icons

//
import { NetworkUtils }     from '@repo/common';

import DialogWindow         from "@widgets/core/DialogWindow";
import UrlInput             from "@widgets/core/UrlInput";
import TextInput            from "@widgets/core/TextInput";

//
//
//
export function LinkEditor( props : LinkEditor.Props ) : JSX.Element
{
    const [text,setText]              = React.useState< string >( props.value ? props.value : "" );
    const [url,setUrl]                = React.useState< string >( NetworkUtils.Protocol.HTTPS + NetworkUtils.PROTOCOL_SEPARATOR );
    
    //

    /////////////////////////////////////////////////////////////////////////////////////////////////////
    async function onSave() : Promise<boolean>
    {
        return true;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////////////
    function onSaved() : void
    { 
        props.onSaved( text, url );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////////////
    function isReady() : boolean
    { 
        return text.length > 2 && NetworkUtils.isUrl( url );
    }


    // ==================================================================================================
    return  <DialogWindow   id="rte-link"
                            title={ "Link Editor" }
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

                    <UrlInput  id="prompt"
                                label={ "URL" }
                                value={ url }
                                onChange={ setUrl } />

                </Stack>
            
            </DialogWindow>;

}

export namespace LinkEditor
{
    export interface Props
    {
        value?      : string;
        onClose     : () => void;
        onSaved     : ( text: string, url : string ) => void;
    }
}

export default LinkEditor;

// eof