//
import React from 'react';
import { JSX } from "react";

//
import { Box, CircularProgress, Stack } from '@mui/material';

import ErrorOutlineOutlinedIcon from '@mui/icons-material/ErrorOutlineOutlined';

import AppModel from '@model/AppModel';

import DialogWindow from "./DialogWindow";
import VideoInput from "./VideoInput";
import TextLabel from './TextLabel';
import FileUtils from '@utils/FileUtils';
import { RestfulService } from '@repo/endpoint';


//
//
//
export function VideoViewer( props : VideoViewer.Props ) : JSX.Element
{
    const appmodel : AppModel = AppModel.instance();

    const [url,setUrl]          = React.useState< string | undefined >( props.value );
    const [error,setError]          = React.useState< boolean >( false );

    //
    //
    React.useEffect( () => componentLoaded(), [] );
        
    ///////////////////////////////////////////////////////////////////////////////////////////////////
    function componentLoaded() : void
    { 
        //getHead(); 
        console.log('VideoViewer', url );
    }
    
    ///////////////////////////////////////////////////////////////////////////////////////////////////
    async function getHead() : Promise<void>
    {  
        const video_path : string = props.value;

        const response : RestfulService.Reply = await appmodel.server.head( props.value );
        if( response.ok && response.headers['content-type'] === FileUtils.Mime.VIDEO_MP4 )
        {
            console.log('getHead', response );
            setUrl( props.value );
        }
        else
        {
            setUrl( "" );
            setError( true );
        }
    }
    
    /////////////////////////////////////////////////////////////////////////////////////////////////
    async function onSave() : Promise<boolean>
    {
        // do nothing
        return true;
    }

    // ===============================================================================================
    return  <DialogWindow   id="viewer-video"
                            title={ "Watch Video" }
                            yesLabel={ appmodel.ui.locale.label( 'common.button.ok' ) }
                            onYes={ onSave }
                            onClose={ props.onClose } >
      
                <Box sx={ { p : 2,  display: "flex", justifyContent: "center" } } >
                    { url === undefined ? <Stack direction="row" spacing={ 2 } sx={ { alignItems: "center" } }>
                        <Box sx={{ display: 'flex' }}>
                            <CircularProgress aria-label="Loading…" />
                        </Box>
                    </Stack> : null }

                    { url !== undefined && url !== "" ?
                    <VideoInput id="video" value={ url } autoPlay={true} maxHeight={400} width="auto" maxWidth="100%" />
                    : null }

                    { error ?
                    <Stack direction="row" spacing={ 2 } sx={ { alignItems: "center" } }>
                        <ErrorOutlineOutlinedIcon sx={{fontSize:"3rem"}} color="error"/>
                        <TextLabel value={ "Video could not be found" } />
                    </Stack> : null }
                </Box>
                
            </DialogWindow>;
}

/**
 * VideoViewer component displays a dialog of a video url.
 *
 * @param props.value - url of the video file
 * @param props.onClose - Callback to close the dialog because the user selected the OK button.
 */
export namespace VideoViewer
{
    export interface Props
    {
        value        : string;
        onClose      : () => void;
    }
}

export default VideoViewer;
// eof