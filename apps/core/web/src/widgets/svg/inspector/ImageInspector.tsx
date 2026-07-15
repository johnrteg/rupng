//
import { JSX } from "react";

import { Slider, Stack, Typography } from "@mui/material";

import { SvgDocument } from "@repo/api";

//
// ImageInspector — the Simple-mode image properties for a selected image object. MVP exposes opacity only;
// crop, mask, frame, and adjustment filters are Phase 2. Presentation-only: reports the updated node upward.
//
export function ImageInspector( props : ImageInspector.Props ) : JSX.Element
{
    ////////////////////////////////////////////////////////////////////////////////////////////
    // commit an opacity change (slider is 0–100; the model stores 0–1)
    function onOpacityChange( _event : Event, value : number | Array<number> ) : void
    {
        const percent : number = Array.isArray( value ) ? value[ 0 ] : value;
        props.onChange( { ...props.node, opacity: percent / 100 } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    return  <Stack spacing={ 2 }>
                <Typography variant="overline" sx={{ color: "text.secondary" }}>{"Image"}</Typography>
                <Typography variant="body2" sx={{ color: "text.secondary" }}>{"Opacity"}</Typography>
                <Slider size="small" min={ 0 } max={ 100 } value={ Math.round( props.node.opacity * 100 ) } onChange={ onOpacityChange } />
            </Stack>;
}

export namespace ImageInspector
{
    export interface Props
    {
        node     : SvgDocument.ImageNode;
        onChange : ( node : SvgDocument.ImageNode ) => void;
    }
}

export default ImageInspector;
