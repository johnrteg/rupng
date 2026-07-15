//
import React from 'react';
import { JSX } from "react";

//
import { Stack } from '@mui/material';

// icons

//
import DialogWindow         from "@widgets/core/DialogWindow";
import TextInput            from "@widgets/core/TextInput";

//
//
//
export function RawHtmlEditor( props : RawHtmlEditor.Props ) : JSX.Element
{
    const [html,setHtml]                = React.useState< string >( props.value );
    
    //

    /////////////////////////////////////////////////////////////////////////////////////////////////////
    async function onSave() : Promise<boolean>
    {
        return true;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////////////
    function onSaved() : void
    { 
        props.onSaved( html );
    }


    // ==================================================================================================
    return  <DialogWindow   id="rte-raw-html"
                            title={ "HTML Editor" }
                            cancelLabel={"Cancel"}
                            yesLabel={ "Replace" }
                            onYes={ onSave }
                            onClose={ props.onClose }
                            onSaved={ onSaved } >
      
                <Stack direction="column" spacing={ 2 } sx={ { p : 2 } } >
                    
                    <TextInput  id="prompt"
                                label={ "HTML" }
                                multiline={ true }
                                maxRows={ 20 }
                                value={ html }
                                onChange={ setHtml } />

                </Stack>
            
            </DialogWindow>;

}

export namespace RawHtmlEditor
{
    export interface Props
    {
        value       : string;
        onClose     : () => void;
        onSaved     : ( new_html : string ) => void;
    }
}

export default RawHtmlEditor;

// eof