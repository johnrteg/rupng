//
import React from 'react';
import { JSX } from "react";

import FileUtils from '@utils/FileUtils';


import VideoInput   from './VideoInput';
import VideoViewer  from './VideoViewer';
import ImageInput   from './ImageInput';
import Show         from './Show';

//

//

export function VideoThumbnailInput( props: VideoThumbnailInput.Props ) : JSX.Element
{
    const [showVideoViewer,setShowVideoViewer]  = React.useState< string | undefined >( undefined );
    const [uncoverVideo,setUncovereVideo]       = React.useState< boolean >( ( props.value && FileUtils.isVideoMime( props.value.mime ) && props.thumbnail !== undefined ) ? false : true );

    React.useEffect( propsChanged, [props.value,props.thumbnail] );

    ////////////////////////////////////////////////////////////////////////////////////////////////////////
    function propsChanged() : void
    {
        setUncovereVideo( ( props.value && FileUtils.isVideoMime( props.value.mime ) && props.thumbnail !== undefined ) ? false : true );
        //console.log('VideoThumbnailInput', props.value,props.thumbnail );
    }


    //
    //
    //
    return <section>
        <Show show={ !uncoverVideo }>
            <ImageInput id={'thumbnail'}
                        value={ props.thumbnail ? props.thumbnail : "" } 
                        maxWidth={ props.maxWidth }
                        maxHeight={ props.maxHeight}
                        onClick={ () => setUncovereVideo( true ) }
                        sx={ props.sx } 
                        />
        </Show>

        <Show show={ uncoverVideo }>
            <VideoInput id={ props.id }
                        value={ props.value.path }
                        alt={ props.alt }
                        autoPlay={ props.thumbnail !== undefined }  // auto play if thubnail was given
                        maxWidth={ props.maxWidth }
                        maxHeight={ props.maxHeight}
                        sx={ props.sx }
                        onClick={ () => setShowVideoViewer( props.value.path ) } />
        </Show>

        { showVideoViewer ? <VideoViewer value={ showVideoViewer } onClose={ () => setShowVideoViewer( undefined ) } /> : null }
    </section>;  
}

export namespace VideoThumbnailInput
{
    export interface Props
    {
        id              : string;
        thumbnail?      : string;
        value           : FileUtils.File;
        alt?            : string;
        maxWidth?       : number | string;
        maxHeight?      : number | string;
        width?          : number | string;
        sx?             : any;
    }
}

export default VideoThumbnailInput;
// eof