import AppModel from "@model/AppModel";
//
import React from 'react';
import { JSX } from "react";

import { Box, CircularProgress, Stack, Typography } from "@mui/material";

import { Media, GetMediaUrl } from '@repo/api';
import { RestfulService } from '@repo/endpoint';

import DialogWindow from '@widgets/core/DialogWindow';

//
// PosterFrameDialog — pick a VIDEO's poster frame. Plays the original (signed URL); the user scrubs to the
// frame they want and confirms — the dialog captures the <video> element's current time and hands it back so
// the parent requests a poster regeneration at that timestamp. Parent owns open/close.
//
export function PosterFrameDialog( props : PosterFrameDialog.Props ) : JSX.Element
{
    const appmodel : AppModel = AppModel.instance();

    const [url,setUrl]         = React.useState< string >( "" );
    const [loading,setLoading] = React.useState< boolean >( true );
    const [at,setAt]           = React.useState< number >( 0 );
    const videoRef             = React.useRef< HTMLVideoElement | null >( null );

    ////////////////////////////////////////////////////////////////////////////////////////////
    React.useEffect( () => void resolve(), [] );

    ////////////////////////////////////////////////////////////////////////////////////////////
    async function resolve() : Promise<void>
    {
        setLoading( true );
        const reply : RestfulService.Reply<GetMediaUrl.Response> = await appmodel.server.fetch( new GetMediaUrl( props.asset.guid ) );
        if( reply.ok && reply.data ) setUrl( reply.data.url );
        setLoading( false );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // capture the current playhead → regenerate the poster there (true closes the dialog)
    async function onSet() : Promise<boolean>
    {
        const atSeconds : number = videoRef.current?.currentTime ?? 0;
        return props.onSet( atSeconds );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    return  <DialogWindow id="media-poster-frame"
                          title={"Set poster frame"}
                          yesLabel={"Use this frame"}
                          cancelLabel={"Cancel"}
                          minWidth="md"
                          ready={ !loading && url !== "" }
                          onYes={ onSet }
                          onClose={ props.onClose }>
                <Stack spacing={ 1 } sx={{ p: 2, alignItems: "center" }}>
                    { loading && <CircularProgress size={ 20 } /> }
                    { !loading && url &&
                        <>
                            <Box component="video" ref={ videoRef } src={ url } controls
                                 onTimeUpdate={ () => setAt( videoRef.current?.currentTime ?? 0 ) }
                                 sx={{ maxWidth: "100%", maxHeight: 420, borderRadius: 1, bgcolor: "background.default" }} />
                            <Typography variant="caption" sx={{ color: "text.secondary" }}>
                                { `Scrub to the frame you want, then "Use this frame" — current: ${ at.toFixed( 1 ) }s` }
                            </Typography>
                        </>
                    }
                    { !loading && !url && <Typography variant="body2" sx={{ color: "error.main" }}>{"Could not load the video."}</Typography> }
                </Stack>
            </DialogWindow>;
}

export namespace PosterFrameDialog
{
    export interface Props
    {
        asset   : Media.Asset;
        onSet   : ( atSeconds : number ) => Promise<boolean>;   // regenerate poster at this time; true closes
        onClose : () => void;
    }
}

export default PosterFrameDialog;
// eof
