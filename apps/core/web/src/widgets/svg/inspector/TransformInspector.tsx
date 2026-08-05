//
import { JSX } from "react";

import { Stack, TextField, Typography } from "@mui/material";

import { SvgDocument } from "@repo/api";

import { ptToUnit, unitToPt } from "@widgets/svg/editor/SvgEditorModel";

//
// TransformInspector — the shared numeric position/size controls (X, Y, W, H, rotation, opacity) for the
// selected object (or the selection's bounding box). Values are shown in the page's display unit and
// converted back to points on edit. Presentation-only: it reports every change up via onChange.
//
export function TransformInspector( props : TransformInspector.Props ) : JSX.Element
{
    // the display DPI for pt↔px conversion (page density; 72 is the editor default)
    const dpi : number = 72;

    ////////////////////////////////////////////////////////////////////////////////////////////
    // apply a partial transform change and report the whole updated transform upward
    function changeTransform( patch : Partial<SvgDocument.Transform> ) : void
    {
        props.onChange( { ...props.transform, ...patch } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // parse a field's string value into a finite number (falls back to 0 on garbage input)
    function toNumber( value : string ) : number
    {
        const parsed : number = Number( value );
        return Number.isFinite( parsed ) ? parsed : 0;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // X / Y / W / H edits convert the entered display-unit value back to points before committing
    function onXChange( value : string ) : void
    {
        changeTransform( { x: unitToPt( toNumber( value ), props.unit, dpi ) } );
    }
    function onYChange( value : string ) : void
    {
        changeTransform( { y: unitToPt( toNumber( value ), props.unit, dpi ) } );
    }
    function onWidthChange( value : string ) : void
    {
        changeTransform( { width: Math.max( 1, unitToPt( toNumber( value ), props.unit, dpi ) ) } );
    }
    function onHeightChange( value : string ) : void
    {
        changeTransform( { height: Math.max( 1, unitToPt( toNumber( value ), props.unit, dpi ) ) } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // rotation is stored in degrees (opacity is handled inline → props.onOpacityChange)
    function onRotationChange( value : string ) : void
    {
        changeTransform( { rotation: toNumber( value ) } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // round a points value to the display unit for showing in a field
    function display( pt : number ) : number
    {
        return Math.round( ptToUnit( pt, props.unit, dpi ) * 100 ) / 100;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    return  <Stack spacing={ 2 }>
                <Typography variant="overline" sx={{ color: "text.secondary" }}>{"Transform"}</Typography>

                <Stack direction="row" spacing={ 1 }>
                    <TextField size="small" type="number" label={"X"} value={ display( props.transform.x ) }
                               onChange={ ( event : React.ChangeEvent<HTMLInputElement> ) : void => onXChange( event.target.value ) } />
                    <TextField size="small" type="number" label={"Y"} value={ display( props.transform.y ) }
                               onChange={ ( event : React.ChangeEvent<HTMLInputElement> ) : void => onYChange( event.target.value ) } />
                </Stack>

                <Stack direction="row" spacing={ 1 }>
                    <TextField  size="small"
                                type="number"
                                label={"W"}
                                value={ display( props.transform.width ) }
                                onChange={ ( event : React.ChangeEvent<HTMLInputElement> ) : void => onWidthChange( event.target.value ) } />
                    <TextField  size="small"
                                type="number"
                                label={"H"}
                                value={ display( props.transform.height ) }
                                onChange={ ( event : React.ChangeEvent<HTMLInputElement> ) : void => onHeightChange( event.target.value ) } />
                </Stack>

                <Stack direction="row" spacing={ 1 }>
                    <TextField size="small" type="number" label={"Rotation"} value={ props.transform.rotation }
                               onChange={ ( event : React.ChangeEvent<HTMLInputElement> ) : void => onRotationChange( event.target.value ) } />
                    <TextField size="small" type="number" label={"Opacity %"} value={ Math.round( props.opacity * 100 ) }
                               onChange={ ( event : React.ChangeEvent<HTMLInputElement> ) : void => props.onOpacityChange( Math.max( 0, Math.min( 100, toNumber( event.target.value ) ) ) / 100 ) } />
                </Stack>
            </Stack>;
}

export namespace TransformInspector
{
    export interface Props
    {
        transform      : SvgDocument.Transform;
        opacity        : number;
        unit           : SvgDocument.Unit;
        onChange       : ( transform : SvgDocument.Transform ) => void;
        onOpacityChange: ( opacity : number ) => void;
    }
}

export default TransformInspector;
