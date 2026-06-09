//
import React from 'react';
import { JSX } from "react";

import { Stack } from '@mui/material';

import BadgeOutlinedIcon        from '@mui/icons-material/BadgeOutlined';


import FileUtils            from '@utils/FileUtils';
import BrowserUtils         from '@utils/BrowserUtils';

import ImageInput           from './ImageInput';
import Show                 from './Show';
import ImageViewer          from './ImageViewer';
import VideoThumbnailInput  from './VideoThumbnailInput';
import ButtonIconDropdown   from './ButtonIconDropdown';
import TextLabel            from './TextLabel';

//
enum vCardAction
{
    DOWNLOAD = "download",
    VIEW = "view"
}
//

export function MediaInput( props: MediaInput.Props ) : JSX.Element
{
    const [showImageViewer,setShowImageViewer]  = React.useState< string | undefined >( undefined );
    const [type,setType]       = React.useState< string >( props.value ? props.value.mime : "" );

    React.useEffect( propsChanged, [props.value,props.thumbnail] );

    ////////////////////////////////////////////////////////////////////////////////////////////////////////
    function propsChanged() : void
    {
        if( props.value && type !== props.value.mime )setType( props.value.mime );
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////
    function onVCard( value : string ) : void
    {
        switch( value )
        {
            case vCardAction.DOWNLOAD : if( props.value )BrowserUtils.download( props.value.path ); break;
            //case vCardAction.VIEW : setViewVcard( true ); break;
        }
    }


    //
    //
    //
    return <section>

        { /* -------------------------------- image ---------------------------------------- */ }
        <Show show={ FileUtils.isImageMime( type ) }>
            <ImageInput id={'image'}
                        value={ props.value ? props.value.path : "" } 
                        maxWidth={ props.maxWidth }
                        maxHeight={ props.maxHeight}
                        onClick={ () => setShowImageViewer( props.value.path ) }
                        sx={ props.sx } 
                        />
        </Show>

        { /* -------------------------------- video ---------------------------------------- */ }
        <Show show={ FileUtils.isVideoMime( type ) }>
            <VideoThumbnailInput id={ props.id }
                        value={ props.value }
                        thumbnail={ props.thumbnail }
                        maxWidth={ props.maxWidth }
                        maxHeight={ props.maxHeight}
                        sx={ props.sx } />
        </Show>

        { /* -------------------------------- vCard ---------------------------------------- */ }
        <Show show={ FileUtils.isVCardMime( type ) }>
            <Stack direction="column" spacing={ 0 } sx={ { p: 0, alignItems:"center" } } >
                <ButtonIconDropdown id="vcard"
                                    label={"vCard"}
                                    icon={ <BadgeOutlinedIcon fontSize="large" /> }
                                    choices={ [ { value : vCardAction.DOWNLOAD, label: "Download" },
                                                    // cors issue? { value : vCardAction.VIEW, label: "View..." }
                                                ] }
                                    onChange={ onVCard } />
                                
                <TextLabel align="center" value={ "vCard" }/>
            </Stack>
        </Show>

        { /* -------------------------------- popus (VideoThumbnailInput managed it's own popus) ---------------------------------------- */ }
        { showImageViewer ? <ImageViewer label={ "Media Viewer" } value={ showImageViewer ? showImageViewer : "" } onClose={ () => setShowImageViewer( undefined ) } /> : null }
    </section>;  
}

export namespace MediaInput
{
    export interface Props
    {
        id              : string;
        thumbnail?      : string;
        value           : FileUtils.File;
        maxWidth?       : number | string;
        maxHeight?      : number | string;
        sx?             : any;
    }
}

export default MediaInput;
// eof