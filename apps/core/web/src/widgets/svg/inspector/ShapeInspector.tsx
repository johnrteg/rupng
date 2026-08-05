//
import React from "react";
import { JSX } from "react";

import { Box, Button, Slider, Stack, TextField, ToggleButton, ToggleButtonGroup, Typography } from "@mui/material";
import AddOutlinedIcon    from "@mui/icons-material/AddOutlined";
import DeleteOutlinedIcon from "@mui/icons-material/DeleteOutlined";

import { SvgDocument } from "@repo/api";

import ButtonIcon from "@widgets/core/ButtonIcon";

import ColorPicker from "@widgets/core/ColorPicker";
import { SvgEditorContext, SvgEditorContextValue } from "@widgets/svg/editor/SvgEditorContext";
import { collectDocColors } from "@widgets/svg/editor/SvgEditorModel";

//
// ShapeInspector — fill (none / solid / gradient), stroke (color + width), corner radius (rects), and opacity
// for a selected shape object. Reports the whole updated node upward via onChange.
// The gradient editor exposes type (linear / radial), angle (linear only), and per-stop color + offset,
// with add / remove stop buttons.
//
export function ShapeInspector( props : ShapeInspector.Props ) : JSX.Element
{
    const editor : SvgEditorContextValue = React.useContext( SvgEditorContext );

    // collect all colors used anywhere in the document for the "Used" swatch row
    const docColors : Array<string> = editor.state.doc !== null ? collectDocColors( editor.state.doc ) : [];
    const usedPalettes : Array<ColorPicker.Palette> = docColors.length > 0 ? [ { label: "Used", colors: docColors } ] : [];

    const fillKind   : SvgDocument.Fill[ "kind" ] = props.node.fill.kind;
    const solidColor : string = props.node.fill.kind === SvgDocument.FillKind.SOLID ? props.node.fill.color : "#3366ff";
    const gradient   : SvgDocument.Gradient | null = props.node.fill.kind === SvgDocument.FillKind.GRADIENT ? props.node.fill.gradient : null;
    const stroke     : SvgDocument.Stroke | null = props.node.stroke;

    ////////////////////////////////////////////////////////////////////////////////////////////
    // merge a node patch and report upward
    function updateNode( patch : Partial<SvgDocument.ShapeNode> ) : void
    {
        props.onChange( { ...props.node, ...patch } );
    }

    // replace the gradient in the fill and report upward
    function updateGradient( patch : Partial<SvgDocument.Gradient> ) : void
    {
        if( gradient === null ) return;
        updateNode( { fill: { kind: SvgDocument.FillKind.GRADIENT, gradient: { ...gradient, ...patch } } } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // switch the fill kind, seeding a sensible default for each
    function onFillKindChange( kind : SvgDocument.Fill[ "kind" ] | null ) : void
    {
        if( kind === null ) return;
        if( kind === SvgDocument.FillKind.SOLID    ) updateNode( { fill: { kind: SvgDocument.FillKind.SOLID, color: solidColor } } );
        if( kind === SvgDocument.FillKind.NONE     ) updateNode( { fill: { kind: SvgDocument.FillKind.NONE } } );
        if( kind === SvgDocument.FillKind.GRADIENT ) updateNode( { fill: { kind: SvgDocument.FillKind.GRADIENT, gradient: ShapeInspector.DEFAULT_GRADIENT } } );
    }

    function onSolidColorChange( color : string ) : void
    {
        updateNode( { fill: { kind: SvgDocument.FillKind.SOLID, color } } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // gradient type toggle (linear ↔ radial)
    function onGradientTypeChange( type : SvgDocument.GradientType | null ) : void
    {
        if( type === null ) return;
        updateGradient( { type } );
    }

////////////////////////////////////////////////////////////////////////////////////////////
    // gradient angle (linear only)
    function onGradientAngleChange( value : string ) : void
    {
        const angle : number = Number( value );
        updateGradient( { angle: Number.isFinite( angle ) ? ( ( angle % 360 ) + 360 ) % 360 : 0 } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // update one stop's color
    function onStopColorChange( index : number, color : string ) : void
    {
        if( gradient === null ) return;
        const stops : Array<SvgDocument.GradientStop> = gradient.stops.map(
            ( stop : SvgDocument.GradientStop, stopIndex : number ) : SvgDocument.GradientStop =>
                stopIndex === index ? { ...stop, color } : stop
        );
        updateGradient( { stops } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // update one stop's offset (0–100 → 0–1)
    function onStopOffsetChange( index : number, value : string ) : void
    {
        if( gradient === null ) return;
        const pct    : number = Number( value );
        const offset : number = Number.isFinite( pct ) ? Math.max( 0, Math.min( 1, pct / 100 ) ) : gradient.stops[ index ]?.offset ?? 0;
        const updated : Array<SvgDocument.GradientStop> = gradient.stops.map(
            ( stop : SvgDocument.GradientStop, stopIndex : number ) : SvgDocument.GradientStop =>
                stopIndex === index ? { ...stop, offset } : stop
        );
        // re-sort by offset so the stop list always reflects gradient order
        const stops : Array<SvgDocument.GradientStop> = [ ...updated ].sort(
            ( a : SvgDocument.GradientStop, b : SvgDocument.GradientStop ) : number => a.offset - b.offset
        );
        updateGradient( { stops } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // add a new stop at the midpoint between the last two stops (or at 0.5 if only one exists)
    function onAddStop() : void
    {
        if( gradient === null ) return;
        const sorted : Array<SvgDocument.GradientStop> = [ ...gradient.stops ].sort(
            ( a : SvgDocument.GradientStop, b : SvgDocument.GradientStop ) : number => a.offset - b.offset
        );
        const last       : SvgDocument.GradientStop = sorted[ sorted.length - 1 ] ?? { offset: 1,  color: "#ffffff", opacity: 1 };
        const secondLast : SvgDocument.GradientStop = sorted[ sorted.length - 2 ] ?? { offset: 0,  color: "#000000", opacity: 1 };
        const newOffset  : number = ( last.offset + secondLast.offset ) / 2;
        const newStop    : SvgDocument.GradientStop = { offset: newOffset, color: last.color, opacity: 1 };
        updateGradient( { stops: [ ...gradient.stops, newStop ] } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // remove a stop by index (minimum two stops required)
    function onRemoveStop( index : number ) : void
    {
        if( gradient === null || gradient.stops.length <= 2 ) return;
        const stops : Array<SvgDocument.GradientStop> = gradient.stops.filter(
            ( _stop : SvgDocument.GradientStop, stopIndex : number ) : boolean => stopIndex !== index
        );
        updateGradient( { stops } );
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

    ////////////////////////////////////////////////////////////////////////////////////////////
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

    ////////////////////////////////////////////////////////////////////////////////////////////
    function onOpacityChange( value : string ) : void
    {
        const percent : number = Number( value );
        const clamped : number = Number.isFinite( percent ) ? Math.max( 0, Math.min( 100, percent ) ) : 100;
        updateNode( { opacity: clamped / 100 } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // classify the current stroke.dash string into a preset name for the toggle group
    function currentDashMode( dash : string | null ) : "solid" | "short" | "long" | "dot"
    {
        if( dash === null ) return "solid";
        if( dash.startsWith( "0 " ) ) return "dot";
        if( dash === "6 4" ) return "short";
        if( dash === "16 4" ) return "long";
        return "solid";
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // extract the dot spacing (gap) from a dot dasharray string, with a sensible default
    function dotSpacingFromDash( dash : string | null, strokeWidth : number ) : number
    {
        if( dash === null || !dash.startsWith( "0 " ) ) return strokeWidth * 4;
        const parsed : number = parseFloat( dash.slice( 2 ) );
        return Number.isFinite( parsed ) ? parsed : strokeWidth * 4;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // switch the dash preset: update stroke.dash and force lineCap=round for dots
    function onDashModeChange( _event : React.MouseEvent<HTMLElement>, mode : string | null ) : void
    {
        if( stroke === null || mode === null ) return;
        const defaultSpacing : number = ( stroke.width || 2 ) * 4;
        const nextDash       : string | null =
            mode === "short" ? "6 4" :
            mode === "long"  ? "16 4" :
            mode === "dot"   ? `0 ${ defaultSpacing }` :
            null;
        // short/long dashes use butt caps so the gaps are clearly visible; dots require round caps
        const nextCap : "butt" | "round" | "square" = mode === "dot" ? "round" : mode === "solid" ? stroke.lineCap : "butt";
        updateNode( { stroke: { ...stroke, dash: nextDash, lineCap: nextCap } } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // adjust dot spacing when the slider moves
    function onDotSpacingChange( _event : Event, value : number | Array<number> ) : void
    {
        if( stroke === null ) return;
        const spacing : number = Array.isArray( value ) ? value[ 0 ] ?? 8 : value;
        updateNode( { stroke: { ...stroke, dash: `0 ${ spacing }`, lineCap: "round" } } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // change the stroke line cap (butt/round/square)
    function onLineCapChange( _event : React.MouseEvent<HTMLElement>, cap : string | null ) : void
    {
        if( stroke === null || cap === null ) return;
        const nextCap : "butt" | "round" | "square" =
            cap === "round" ? "round" : cap === "square" ? "square" : "butt";
        updateNode( { stroke: { ...stroke, lineCap: nextCap } } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // render the line-cap toggle section (shown when stroke exists)
    function lineCapRow() : JSX.Element | null
    {
        if( stroke === null ) return null;
        return  <Stack direction="row" spacing={ 1 } sx={{ alignItems: "center" }}>
                    <Typography variant="caption" sx={{ color: "text.secondary", minWidth: 40 }}>{"Cap"}</Typography>
                    <ToggleButtonGroup size="small" exclusive value={ stroke.lineCap ?? "butt" }
                                       onChange={ onLineCapChange }>
                        <ToggleButton value="butt">{"Flat"}</ToggleButton>
                        <ToggleButton value="round">{"Round"}</ToggleButton>
                        <ToggleButton value="square">{"Square"}</ToggleButton>
                    </ToggleButtonGroup>
                </Stack>;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // render the dash-preset section (shown when stroke exists): solid / short / long / dots + optional spacing
    function dashRow() : JSX.Element | null
    {
        if( stroke === null ) return null;
        const mode    : "solid" | "short" | "long" | "dot" = currentDashMode( stroke.dash );
        const spacing : number = dotSpacingFromDash( stroke.dash, stroke.width );
        return  <Stack spacing={ 1 }>
                    <Stack direction="row" spacing={ 1 } sx={{ alignItems: "center" }}>
                        <Typography variant="caption" sx={{ color: "text.secondary", minWidth: 40 }}>{"Dash"}</Typography>
                        <ToggleButtonGroup size="small" exclusive value={ mode }
                                           onChange={ onDashModeChange }>
                            <ToggleButton value="solid">{"—"}</ToggleButton>
                            <ToggleButton value="short">{"- -"}</ToggleButton>
                            <ToggleButton value="long">{"— —"}</ToggleButton>
                            <ToggleButton value="dot">{"···"}</ToggleButton>
                        </ToggleButtonGroup>
                    </Stack>
                    { mode === "dot" &&
                        <Stack direction="row" spacing={ 1 } sx={{ alignItems: "center" }}>
                            <Typography variant="caption" sx={{ color: "text.secondary", minWidth: 40 }}>{"Gap"}</Typography>
                            <Slider min={ 2 } max={ 60 } step={ 1 } value={ spacing }
                                    onChange={ onDotSpacingChange } sx={{ flex: 1 }} />
                            <Typography variant="caption" sx={{ minWidth: 28 }}>{ `${ Math.round( spacing ) }` }</Typography>
                        </Stack> }
                </Stack>;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // one gradient stop row: caption label + compact color swatch + offset % + optional remove button
    function stopRow( stop : SvgDocument.GradientStop, index : number ) : JSX.Element
    {
        const canRemove : boolean = gradient !== null && gradient.stops.length > 2;
        // compact color swatch passed as icon so ColorPicker renders as a small button with no label padding
        const swatch : JSX.Element = <Box sx={{ width: 16, height: 16, borderRadius: "2px", bgcolor: stop.color, border: 1, borderColor: "divider" }} />;
        return  <Stack key={ index } direction="row" spacing={ 0.5 } sx={{ alignItems: "center" }}>
                    <Typography variant="caption" sx={{ color: "text.secondary", minWidth: 42 }}>{ `Stop ${ index + 1 }` }</Typography>
                    <ColorPicker id={ `svg-grad-stop-${ index }` } icon={ swatch } label={ "" }
                                 value={ stop.color } choices={ ColorPicker.COLORS }
                                 palettes={ usedPalettes.length > 0 ? usedPalettes : undefined }
                                 onChange={ ( color : string ) : void => onStopColorChange( index, color ) } />
                    <TextField size="small" type="number" label={"Offset %"} value={ Math.round( stop.offset * 100 ) }
                               slotProps={{ htmlInput: { min: 0, max: 100 } }} sx={{ width: 90 }}
                               onChange={ ( event : React.ChangeEvent<HTMLInputElement> ) : void => onStopOffsetChange( index, event.target.value ) } />
                    { canRemove &&
                        <ButtonIcon id={ `svg-grad-stop-remove-${ index }` } label={"Remove stop"} size="small"
                                    icon={ <DeleteOutlinedIcon fontSize="small" /> }
                                    onClick={ () : void => onRemoveStop( index ) } /> }
                </Stack>;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // a CSS linear-gradient preview bar so the user can see the blended result
    function gradientPreview() : JSX.Element | null
    {
        if( gradient === null ) return null;
        const sorted : Array<SvgDocument.GradientStop> = [ ...gradient.stops ].sort(
            ( a : SvgDocument.GradientStop, b : SvgDocument.GradientStop ) : number => a.offset - b.offset
        );
        const stops : string = sorted
            .map( ( stop : SvgDocument.GradientStop ) : string => `${ stop.color } ${ Math.round( stop.offset * 100 ) }%` )
            .join( ", " );
        const cssGradient : string = gradient.type === SvgDocument.GradientType.RADIAL
            ? `radial-gradient(${ stops })`
            : `linear-gradient(${ gradient.angle }deg, ${ stops })`;
        return <Box sx={{ width: "100%", height: 20, borderRadius: 1, border: 1, borderColor: "divider", background: cssGradient }} />;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // the inline gradient editor panel
    function gradientEditor() : JSX.Element | null
    {
        if( gradient === null ) return null;
        return  <Stack spacing={ 2 }>
                    { gradientPreview() }
                    <ToggleButtonGroup size="small" exclusive value={ gradient.type }
                                       onChange={ ( _event : React.MouseEvent<HTMLElement>, value : SvgDocument.GradientType | null ) : void => onGradientTypeChange( value ) }>
                        <ToggleButton value={ SvgDocument.GradientType.LINEAR }>{"Linear"}</ToggleButton>
                        <ToggleButton value={ SvgDocument.GradientType.RADIAL }>{"Radial"}</ToggleButton>
                    </ToggleButtonGroup>
                    { gradient.type === SvgDocument.GradientType.LINEAR &&
                        <TextField size="small" type="number" label={"Angle °"} value={ gradient.angle }
                                   slotProps={{ htmlInput: { min: 0, max: 360 } }}
                                   onChange={ ( event : React.ChangeEvent<HTMLInputElement> ) : void => onGradientAngleChange( event.target.value ) } /> }
                    <Stack spacing={ 0.5 }>
                        { gradient.stops.map( ( stop : SvgDocument.GradientStop, index : number ) : JSX.Element => stopRow( stop, index ) ) }
                    </Stack>
                    <Button size="small" startIcon={ <AddOutlinedIcon /> } onClick={ onAddStop }>{"Add stop"}</Button>
                </Stack>;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    return  <Stack spacing={ 2 }>
                <Typography variant="overline" sx={{ color: "text.secondary" }}>{"Shape"}</Typography>

                <ToggleButtonGroup size="small" exclusive value={ fillKind }
                                   onChange={ ( _event : React.MouseEvent<HTMLElement>, value : SvgDocument.Fill[ "kind" ] | null ) : void => onFillKindChange( value ) }>
                    <ToggleButton value={ SvgDocument.FillKind.NONE }>{"None"}</ToggleButton>
                    <ToggleButton value={ SvgDocument.FillKind.SOLID }>{"Solid"}</ToggleButton>
                    <ToggleButton value={ SvgDocument.FillKind.GRADIENT }>{"Gradient"}</ToggleButton>
                </ToggleButtonGroup>

                { fillKind === SvgDocument.FillKind.SOLID &&
                    <ColorPicker id="svg-shape-fill" label={"Fill"} value={ solidColor } choices={ ColorPicker.COLORS }
                                 palettes={ usedPalettes.length > 0 ? usedPalettes : undefined }
                                 onChange={ onSolidColorChange } /> }

                { fillKind === SvgDocument.FillKind.GRADIENT && gradientEditor() }

                <Stack direction="row" spacing={ 1 }>
                    <TextField size="small" type="number" label={"Stroke width"} value={ stroke?.width ?? 0 }
                               onChange={ ( event : React.ChangeEvent<HTMLInputElement> ) : void => onStrokeWidthChange( event.target.value ) } />
                    { stroke !== null &&
                        <ColorPicker id="svg-shape-stroke" label={"Stroke"} value={ stroke.color } choices={ ColorPicker.COLORS }
                                     palettes={ usedPalettes.length > 0 ? usedPalettes : undefined }
                                     onChange={ onStrokeColorChange } /> }
                </Stack>

                { lineCapRow() }
                { dashRow() }

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
        type: SvgDocument.GradientType.LINEAR, angle: 90,
        stops: [ { offset: 0, color: "#3366ff", opacity: 1 }, { offset: 1, color: "#8899ff", opacity: 1 } ],
    };
}

export default ShapeInspector;
