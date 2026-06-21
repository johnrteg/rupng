//
import React from 'react';
import { JSX } from "react";

//
import CardMedia from '@mui/material/CardMedia';

//

export function ImageInput( props: ImageInput.Props ) : JSX.Element | null
{
    const [src,setSrc]   = React.useState< string | null >( props.value );

    React.useEffect( updateImage, [props.value] );

    //////////////////////////////////////////////////////////////////////////////////////////////////
    function onLoad() : void
    {
        //console.log('onLoad', props.src );
    }

    //////////////////////////////////////////////////////////////////////////////////////////////////
    function updateImage() : void
    {
        let url : string | null = props.value;

        // not null and qualified extension
        if( url !== null && url.indexOf('.') > 0 && !url.startsWith('blob:')  )
        {
            // force cache
            if( url.indexOf('?') > 0 )
                url += '&dummy=' + Date.now();
            else
                url += '?dummy=' + Date.now();
        }

        setSrc( url );
    }

    //////////////////////////////////////////////////////////////////////////////////////////////////
    function onError() : void
    {
        //console.log('onError', props.src );
        if( props.defaultSrc )setSrc( props.defaultSrc  );
    }

    return src !== null ? <CardMedia
                        component="img"
                        key={ props.id }
                        image={ src }
                        alt={ props.alt ? props.alt : "image" }
                        sx={ {
                                maxWidth    : props.maxWidth ? props.maxWidth : undefined,
                                maxHeight   : props.maxHeight ? props.maxHeight : undefined,
                                cursor      : props.onClick ? "pointer" : undefined,
                                ...( props.sx || {} ) } }
                        onLoad={ onLoad }
                        onClick={ props.onClick ? props.onClick : undefined }
                        onError={ onError } />
                : null;  
}

export namespace ImageInput
{
    export interface Props
    {
        id              : string;
        value           : string | null;
        alt?            : string;
        defaultSrc?     : string;
        maxWidth?       : number | string;
        maxHeight?      : number | string;
        sx?             : any;
        onClick?        : () => void;
    }
}



export default ImageInput;
// eof