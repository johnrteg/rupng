//
import React from 'react';
import { JSX } from "react";

//
import { Box } from '@mui/material';

//
import DialogWindow             from "@widgets/core/DialogWindow";
import AppModel              from '@model/AppModel';
import { RestfulService } from '@repo/endpoint';
import CodeEditorInput from './CodeEditorInput';


//
//
//
export function VCardViewer( props : VCardViewer.Props ) : JSX.Element
{
    const appmodel : AppModel = AppModel.instance();
    
    //
    React.useEffect( () => componentLoaded(), [] );

    ///////////////////////////////////////////////////////////////////////////////////////////////////
    function componentLoaded() : void
    {  
        getData();
    }

    /////////////////////////////////////////////////////////////////////////////////////////////////
    async function getData() : Promise<void>
    {

        const response : RestfulService.Reply = await appmodel.server.get( props.url );
        
        if( response.ok )
        {
            console.log('card', response.data );
        }
    }

    /////////////////////////////////////////////////////////////////////////////////////////////////
    async function onSave() : Promise<boolean>
    {
        // do nothing
        return true;
    }

    
    // ===============================================================================================
    return  <DialogWindow   id="json-viewer"
                            title={ "vCard" }
                            yesLabel={ appmodel.ui.locale.label( 'common.button.ok' ) }
                            onYes={ onSave }
                            onClose={ props.onClose } >
      
                <Box sx={ { p : 2 } } >
                    <CodeEditorInput id="code" label={ "Data" }
                                    width={ "100%" }
                                    value={ "" }
                                    editable={ false }
                                    format={ "json" } />
                </Box>
                

            </DialogWindow>;

}

export namespace VCardViewer
{
    export interface Props
    {
        url        : string;
        onClose      : () => void;
    }
}

export default VCardViewer;

// eof