//
import { JSX } from "react";

import { Stack, TextField, ToggleButton, ToggleButtonGroup, Typography } from "@mui/material";

import { SvgDocument } from "@repo/api";

import ColorPicker from "@widgets/core/ColorPicker";

//
// ShapeInspector — fill (none / solid / gradient), stroke (color + width), corner radius (rects), and opacity
// for a selected shape object. Presentation-only: it reports the whole updated node up via onChange. The
// gradient editor itself is a later phase — the toggle just seeds a default linear gradient here.
//
export function ShapeInspector( props : ShapeInspector.Props ) : JSX.Element
{
    const fillKind : SvgDocument.Fill[ "kind" ] = props.node.fill.kind;
    const solidColor : string = props.node.fill.kind === "solid" ? props.node.fill.color : "#3366ff";
    const stroke : SvgDocument.Stroke | null = props.node.stroke;

    ////////////////////////////////////////////////////////////////////////////////////////////
    // merge a node patch and report upward
    function updateNode( patch : Partial<SvgDocument.ShapeNode> ) : void
    {
        props.onChange( { ...props.node, ...patch } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // switch the fill kind, seeding a sensible default for each
    function onFillKindChange( kind : SvgDocument.Fill[ "kind" ] | null ) : void
    {
        if( kind === null ) return;
        if( kind === "solid" )    updateNode( { fill: { kind: "solid", color: solidColor } } );
        if( kind === "none" )     updateNode( { fill: { kind: "none" } } );
        if( kind === "gradient" ) updateNode( { fill: { kind: "gradient", gradient: ShapeInspector.DEFAULT_GRADIENT } } );
    }
    function onSolidColorChange( color : string ) : void
    {
        updateNode( { fill: { kind: "solid", color } } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // stroke width drives whether a stroke exists at all (0 removes it)
    function onStrokeWidthChange( value : string ) : void
    {
        const width : number = Number( value );
        if( !Number.isFinite( width ) || width <= 0 ) { updateNode( { stroke: null } ); return; }
        const next : SvgDocument.Stroke = stroke !== null
            ? { ...stroke, width }
            : { color: "#000000", width, dash: null, lineCap: "butt", lineJoin: "miter" };
        updateNode( { stroke: next } );
    }
    function onStrokeColorChange( color : string ) : void
    {
        if( stroke === null ) return;
        updateNode( { stroke: { ...stroke, color } } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    function onCornerRadiusChange( value : string ) : void
    {
        const radius : number = Number( value );
        updateNode( { cornerRadius: Number.isFinite( radius ) && radius >= 0 ? radius : 0 } );
    }
    function onOpacityChange( value : string ) : void
    {
        const percent : number = Number( value );
        const clamped : number = Number.isFinite( percent ) ? Math.max( 0, Math.min( 100, percent ) ) : 100;
        updateNode( { opacity: clamped / 100 } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    return  <Stack spacing={ 2 }>
                <Typography variant="overline" sx={{ color: "text.secondary" }}>{"Shape"}</Typography>

                <ToggleButtonGroup size="small" exclusive value={ fillKind }
                                   onChange={ ( _event : React.MouseEvent<HTMLElement>, value : SvgDocument.Fill[ "kind" ] | null ) : void => onFillKindChange( value ) }>
                    <ToggleButton value="none">{"None"}</ToggleButton>
                    <ToggleButton value="solid">{"Solid"}</ToggleButton>
                    <ToggleButton value="gradient">{"Gradient"}</ToggleButton>
                </ToggleButtonGroup>

                { fillKind === "solid" &&
                    <ColorPicker id="svg-shape-fill" label={"Fill"} value={ solidColor } choices={ ColorPicker.COLORS } onChange={ onSolidColorChange } /> }

                <Stack direction="row" spacing={ 1 }>
                    <TextField size="small" type="number" label={"Stroke width"} value={ stroke?.width ?? 0 }
                               onChange={ ( event : React.ChangeEvent<HTMLInputElement> ) : void => onStrokeWidthChange( event.target.value ) } />
                    { stroke !== null &&
                        <ColorPicker id="svg-shape-stroke" label={"Stroke"} value={ stroke.color } choices={ ColorPicker.COLORS } onChange={ onStrokeColorChange } /> }
                </Stack>

                { props.node.shapeType === SvgDocument.ShapeType.RECT &&
                    <TextField size="small" type="number" label={"Corner radius"} value={ props.node.cornerRadius }
                               onChange={ ( event : React.ChangeEvent<HTMLInputElement> ) : void => onCornerRadiusChange( event.target.value ) } /> }

                <TextField size="small" type="number" label={"Opacity %"} value={ Math.round( props.node.opacity * 100 ) }
                           onChange={ ( event : React.ChangeEvent<HTMLInputElement> ) : void => onOpacityChange( event.target.value ) } />
            </Stack>;
}

export namespace ShapeInspector
{
    export interface Props
    {
        node     : SvgDocument.ShapeNode;
        onChange : ( node : SvgDocument.ShapeNode ) => void;
    }

    /** The default gradient seeded when the fill is switched to "gradient" (a simple two-stop linear). */
    export const DEFAULT_GRADIENT : SvgDocument.Gradient =
    {
        type: "linear", angle: 90,
        stops: [ { offset: 0, color: "#3366ff", opacity: 1 }, { offset: 1, color: "#8899ff", opacity: 1 } ],
    };
}

export default ShapeInspector;
