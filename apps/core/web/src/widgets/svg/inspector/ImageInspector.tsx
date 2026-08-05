//
import React from "react";
import { JSX } from "react";

import { Button, Slider, Stack, Typography } from "@mui/material";
import CropOutlinedIcon from "@mui/icons-material/CropOutlined";

import { SvgDocument } from "@repo/api";

import CheckboxInput from "@widgets/core/CheckboxInput";
import { SvgEditorContext, SvgEditorContextValue } from "@widgets/svg/editor/SvgEditorContext";
import { SvgEditorActionType } from "@widgets/svg/editor/SvgEditorModel";

//
// ImageInspector — opacity control, lock-aspect-ratio toggle, and crop-mode entry for a selected image
// object. Crop mode activates a draggable crop-rect overlay in the InteractionOverlay via cropNodeId state.
//
export function ImageInspector( props : ImageInspector.Props ) : JSX.Element
{
    const editor : SvgEditorContextValue = React.useContext( SvgEditorContext );
    const isInCropMode : boolean = editor.state.cropNodeId === props.node.id;

    ////////////////////////////////////////////////////////////////////////////////////////////
    // commit an opacity change (slider is 0–100; the model stores 0–1)
    function onOpacityChange( _event : Event, value : number | Array<number> ) : void
    {
        const percent : number = Array.isArray( value ) ? ( value[ 0 ] ?? 0 ) : value;
        props.onChange( { ...props.node, opacity: percent / 100 } );
    }

    // toggle aspect lock on the node
    function onAspectLockChange( locked : boolean ) : void
    {
        props.onChange( { ...props.node, aspectLocked: locked } );
    }

    // toggle crop mode — enter if not active, exit if already active
    function onCropToggle() : void
    {
        editor.dispatch( { type: SvgEditorActionType.SET_CROP_NODE, nodeId: isInCropMode ? null : props.node.id } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    return  <Stack spacing={ 2 }>
                <Typography variant="overline" sx={{ color: "text.secondary" }}>{"Image"}</Typography>
                <Typography variant="body2" sx={{ color: "text.secondary" }}>{"Opacity"}</Typography>
                <Slider size="small" min={ 0 } max={ 100 } value={ Math.round( props.node.opacity * 100 ) } onChange={ onOpacityChange } />
                <CheckboxInput id="svg-image-aspect-lock" label={"Lock aspect ratio"} value={ props.node.aspectLocked }
                               onChange={ onAspectLockChange } />
                <Button size="small" variant={ isInCropMode ? "contained" : "outlined" }
                        startIcon={ <CropOutlinedIcon /> }
                        onClick={ onCropToggle }>
                    { isInCropMode ? "Done cropping" : "Crop image" }
                </Button>
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
