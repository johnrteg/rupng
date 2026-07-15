//
import { JSX } from "react";

import { Stack, TextField, ToggleButton, ToggleButtonGroup, Typography } from "@mui/material";
import FormatBoldOutlinedIcon      from "@mui/icons-material/FormatBoldOutlined";
import FormatAlignLeftOutlinedIcon   from "@mui/icons-material/FormatAlignLeftOutlined";
import FormatAlignCenterOutlinedIcon from "@mui/icons-material/FormatAlignCenterOutlined";
import FormatAlignRightOutlinedIcon  from "@mui/icons-material/FormatAlignRightOutlined";

import { SvgDocument } from "@repo/api";

import SelectInput from "@widgets/core/SelectInput";
import ColorPicker from "@widgets/core/ColorPicker";
import { GOOGLE_FONTS_TOP_50, DEFAULT_TEXT_STYLE } from "@widgets/svg/editor/SvgEditorModel";

//
// TextInspector — the Simple-mode text properties for a selected text object: font family (top-50 Google
// fonts), size, bold, color, and alignment. It edits the FIRST span's style (MVP treats a text object as
// uniformly styled) and reports the whole updated node upward. (TextStyle carries no italic field, so italic
// is not offered.)
//
export function TextInspector( props : TextInspector.Props ) : JSX.Element
{
    // the style shown/edited — the first span's, or the neutral default when the node has no spans yet
    const style : SvgDocument.TextStyle = props.node.content[ 0 ]?.style ?? DEFAULT_TEXT_STYLE;
    const isBold : boolean = Number( style.fontWeight ) >= 700;

    // the font-family dropdown choices (the v1 typography shortlist)
    const fontChoices : Array<SelectInput.Choice> = GOOGLE_FONTS_TOP_50.map( ( family : string ) : SelectInput.Choice => ( { value: family, label: family } ) );

    ////////////////////////////////////////////////////////////////////////////////////////////
    // merge a style patch into the first span (creating one when the node is empty) and report upward
    function updateStyle( patch : Partial<SvgDocument.TextStyle> ) : void
    {
        const nextStyle : SvgDocument.TextStyle = { ...style, ...patch };
        const content : Array<SvgDocument.TextSpan> = props.node.content.length === 0
            ? [ { text: "", style: nextStyle } ]
            : props.node.content.map( ( span : SvgDocument.TextSpan, index : number ) : SvgDocument.TextSpan => ( index === 0 ? { ...span, style: nextStyle } : span ) );
        props.onChange( { ...props.node, content } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    function onFamilyChange( family : string ) : void
    {
        updateStyle( { fontFamily: family } );
    }
    function onSizeChange( value : string ) : void
    {
        const size : number = Number( value );
        updateStyle( { fontSize: Number.isFinite( size ) && size > 0 ? size : style.fontSize } );
    }
    function onColorChange( color : string ) : void
    {
        updateStyle( { color } );
    }
    function onBoldToggle() : void
    {
        updateStyle( { fontWeight: isBold ? 400 : 700 } );
    }
    function onAlignChange( align : SvgDocument.TextStyle[ "align" ] | null ) : void
    {
        if( align !== null ) updateStyle( { align } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    return  <Stack spacing={ 2 }>
                <Typography variant="overline" sx={{ color: "text.secondary" }}>{"Text"}</Typography>

                <SelectInput id="svg-text-font" label={"Font"} value={ String( style.fontFamily ) } choices={ fontChoices }
                             onChange={ onFamilyChange } />

                <Stack direction="row" spacing={ 1 } sx={{ alignItems: "center" }}>
                    <TextField size="small" type="number" label={"Size"} value={ style.fontSize }
                               onChange={ ( event : React.ChangeEvent<HTMLInputElement> ) : void => onSizeChange( event.target.value ) } />
                    <ToggleButtonGroup size="small" value={ isBold ? [ "bold" ] : [] }>
                        <ToggleButton value="bold" onClick={ onBoldToggle }><FormatBoldOutlinedIcon fontSize="small" /></ToggleButton>
                    </ToggleButtonGroup>
                </Stack>

                <ColorPicker id="svg-text-color" label={"Text color"} value={ style.color } choices={ ColorPicker.COLORS }
                             onChange={ onColorChange } />

                <ToggleButtonGroup size="small" exclusive value={ style.align }
                                   onChange={ ( _event : React.MouseEvent<HTMLElement>, value : SvgDocument.TextStyle[ "align" ] | null ) : void => onAlignChange( value ) }>
                    <ToggleButton value="left"><FormatAlignLeftOutlinedIcon fontSize="small" /></ToggleButton>
                    <ToggleButton value="center"><FormatAlignCenterOutlinedIcon fontSize="small" /></ToggleButton>
                    <ToggleButton value="right"><FormatAlignRightOutlinedIcon fontSize="small" /></ToggleButton>
                </ToggleButtonGroup>
            </Stack>;
}

export namespace TextInspector
{
    export interface Props
    {
        node     : SvgDocument.TextNode;
        onChange : ( node : SvgDocument.TextNode ) => void;
    }
}

export default TextInspector;
