//
import React from 'react';
import { JSX } from "react";

//
import { Box } from '@mui/material';

//
import DialogWindow     from "@widgets/core/DialogWindow";
import ImageInput       from "./ImageInput";
import AppModel from '@model/AppModel';


//
//
//
export function ImageViewer( props : ImageViewer.Props ) : JSX.Element
{
    const appdata : AppModel = AppModel.instance();
    //
    //React.useEffect( () => componentLoaded(), [] );

    ///////////////////////////////////////////////////////////////////////////////////////////////////
    //function componentLoaded() : void
    //{  
    //}

    /////////////////////////////////////////////////////////////////////////////////////////////////
    async function onSave() : Promise<boolean>
    {
        // do nothing
        return true;
    }

    
    // ===============================================================================================
    return  <DialogWindow   id="image-viewer"
                            title={ props.label }
                            minWidth="md"
                            yesLabel={ appdata.ui.locale.label( 'common.button.ok' ) }
                            onYes={ onSave }
                            onClose={ props.onClose } >
      
                <Box sx={ { p : 2 } } >
                    <ImageInput id="img" value={ props.value } />
                </Box>
                
            </DialogWindow>;

}

export namespace ImageViewer
{
    export interface Props
    {
        label       : string;
        value       : string;
        onClose     : () => void;
    }
}

export default ImageViewer;

// eof