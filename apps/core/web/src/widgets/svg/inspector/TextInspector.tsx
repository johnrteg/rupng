//
import React from "react";
import { JSX } from "react";

import { FormControl, InputLabel, MenuItem, Select, SelectChangeEvent, Stack, TextField, ToggleButton, ToggleButtonGroup, Typography } from "@mui/material";
import FormatBoldOutlinedIcon           from "@mui/icons-material/FormatBoldOutlined";
import FormatItalicOutlinedIcon         from "@mui/icons-material/FormatItalicOutlined";
import FormatUnderlinedOutlinedIcon     from "@mui/icons-material/FormatUnderlinedOutlined";
import StrikethroughSOutlinedIcon       from "@mui/icons-material/StrikethroughSOutlined";
import FormatAlignLeftOutlinedIcon      from "@mui/icons-material/FormatAlignLeftOutlined";
import FormatAlignCenterOutlinedIcon    from "@mui/icons-material/FormatAlignCenterOutlined";
import FormatAlignRightOutlinedIcon     from "@mui/icons-material/FormatAlignRightOutlined";
import FormatAlignJustifyOutlinedIcon   from "@mui/icons-material/FormatAlignJustifyOutlined";

import { SvgDocument } from "@repo/api";

import ColorPicker from "@widgets/core/ColorPicker";
import { ensureFamiliesLoaded } from "@widgets/core/GoogleFonts";
import { GOOGLE_FONTS_TOP_50, DEFAULT_TEXT_STYLE, collectDocColors } from "@widgets/svg/editor/SvgEditorModel";
import { SvgEditorContext, SvgEditorContextValue } from "@widgets/svg/editor/SvgEditorContext";

//
// TextInspector — the Simple-mode text properties for a selected text object: font family (top-50 Google
// fonts), size, bold, italic, color, and alignment. It edits the FIRST span's style (MVP treats a text
// object as uniformly styled) and reports the whole updated node upward. Each font option is rendered in
// its own typeface for a live preview.
//
export function TextInspector( props : TextInspector.Props ) : JSX.Element
{
    const editor : SvgEditorContextValue = React.useContext( SvgEditorContext );

    // collect all colors used anywhere in the document for the "Used" swatch row
    const docColors : Array<string> = editor.state.doc !== null ? collectDocColors( editor.state.doc ) : [];

    // the style shown/edited — the first span's, or the neutral default when the node has no spans yet
    const style           : SvgDocument.TextStyle = props.node.content[ 0 ]?.style ?? DEFAULT_TEXT_STYLE;
    const isBold          : boolean = Number( style.fontWeight ) >= 700;
    const isItalic        : boolean = style.fontStyle === "italic";
    const isUnderline     : boolean = style.textDecoration === "underline";
    const isStrikethrough : boolean = style.textDecoration === "line-through";

    // SvgDesignEditor already preloads these on mount (before any selection) — this is just a safety net in
    // case TextInspector ever mounts standalone; ensureFamiliesLoaded is idempotent, so this is a no-op then.
    React.useEffect( () : void => ensureFamiliesLoaded( GOOGLE_FONTS_TOP_50 ), [] );

    ////////////////////////////////////////////////////////////////////////////////////////////
    // count display lines in the current node text (split on newline, minimum 1)
    function textLineCount() : number
    {
        const text : string = props.node.content
            .map( ( span : SvgDocument.TextSpan ) : string => span.text )
            .join( "" );
        return Math.max( 1, text.split( "\n" ).length );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // merge a style patch into the first span (creating one when the node is empty) and report upward;
    // when font size changes, resize the bounding box height to match the current line count at the new size
    function updateStyle( patch : Partial<SvgDocument.TextStyle> ) : void
    {
        const nextStyle : SvgDocument.TextStyle = { ...style, ...patch };
        const content : Array<SvgDocument.TextSpan> = props.node.content.length === 0
            ? [ { text: "", style: nextStyle } ]
            : props.node.content.map( ( span : SvgDocument.TextSpan, index : number ) : SvgDocument.TextSpan => ( index === 0 ? { ...span, style: nextStyle } : span ) );
        const newFontSize : number | undefined = patch.fontSize;
        const transform   : SvgDocument.Transform = newFontSize !== undefined
            ? { ...props.node.transform, height: textLineCount() * newFontSize * 1.2 }
            : props.node.transform;
        props.onChange( { ...props.node, content, transform } );
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
    function onItalicToggle() : void
    {
        updateStyle( { fontStyle: isItalic ? "normal" : "italic" } );
    }
    function onUnderlineToggle() : void
    {
        updateStyle( { textDecoration: isUnderline ? "none" : "underline" } );
    }
    function onStrikethroughToggle() : void
    {
        updateStyle( { textDecoration: isStrikethrough ? "none" : "line-through" } );
    }
    function onLineSpacingChange( value : string ) : void
    {
        const ls : number = Number( value );
        updateStyle( { lineSpacing: Number.isFinite( ls ) && ls > 0 ? ls : style.lineSpacing } );
    }
    function onLetterSpacingChange( value : string ) : void
    {
        const ls : number = Number( value );
        updateStyle( { letterSpacing: Number.isFinite( ls ) ? ls : 0 } );
    }
    function onAlignChange( align : SvgDocument.TextStyle[ "align" ] | null ) : void
    {
        if( align !== null ) updateStyle( { align } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // one MenuItem in the font dropdown — styled in the font itself so the user sees a live preview
    function fontMenuItem( family : string ) : JSX.Element
    {
        return  <MenuItem key={ family } value={ family }>
                    <Typography sx={{ fontFamily: family }}>{ family }</Typography>
                </MenuItem>;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    return  <Stack spacing={ 2 }>
                <Typography variant="overline" sx={{ color: "text.secondary" }}>{"Text"}</Typography>

                <FormControl size="small" fullWidth>
                    <InputLabel>{"Font"}</InputLabel>
                    <Select value={ String( style.fontFamily ) } label={"Font"}
                            renderValue={ ( value : string ) : JSX.Element => <Typography sx={{ fontFamily: value }}>{ value }</Typography> }
                            onChange={ ( event : SelectChangeEvent<string>, _child : React.ReactNode ) : void => onFamilyChange( event.target.value ) }>
                        { GOOGLE_FONTS_TOP_50.map( fontMenuItem ) }
                    </Select>
                </FormControl>

                <Stack direction="row" spacing={ 1 } sx={{ alignItems: "center" }}>
                    <TextField size="small" type="number" label={"Size"} value={ style.fontSize }
                               onChange={ ( event : React.ChangeEvent<HTMLInputElement> ) : void => onSizeChange( event.target.value ) } />
                    <ToggleButtonGroup size="small" value={ [ ...( isBold ? [ "bold" ] : [] ), ...( isItalic ? [ "italic" ] : [] ), ...( isUnderline ? [ "underline" ] : [] ), ...( isStrikethrough ? [ "strikethrough" ] : [] ) ] }>
                        <ToggleButton value="bold"          onClick={ onBoldToggle          }><FormatBoldOutlinedIcon        fontSize="small" /></ToggleButton>
                        <ToggleButton value="italic"        onClick={ onItalicToggle        }><FormatItalicOutlinedIcon      fontSize="small" /></ToggleButton>
                        <ToggleButton value="underline"     onClick={ onUnderlineToggle     }><FormatUnderlinedOutlinedIcon  fontSize="small" /></ToggleButton>
                        <ToggleButton value="strikethrough" onClick={ onStrikethroughToggle }><StrikethroughSOutlinedIcon    fontSize="small" /></ToggleButton>
                    </ToggleButtonGroup>
                </Stack>

                <Stack direction="row" spacing={ 1 }>
                    <TextField size="small" type="number" label={"Line spacing"} value={ style.lineSpacing }
                               slotProps={{ htmlInput: { step: 0.1, min: 0.5, max: 5 } }}
                               onChange={ ( event : React.ChangeEvent<HTMLInputElement> ) : void => onLineSpacingChange( event.target.value ) } />
                    <TextField size="small" type="number" label={"Char spacing"} value={ style.letterSpacing ?? 0 }
                               slotProps={{ htmlInput: { step: 0.5 } }}
                               onChange={ ( event : React.ChangeEvent<HTMLInputElement> ) : void => onLetterSpacingChange( event.target.value ) } />
                </Stack>

                <ColorPicker id="svg-text-color" label={"Text color"} value={ style.color } choices={ ColorPicker.COLORS }
                             palettes={ docColors.length > 0 ? [ { label: "Used", colors: docColors } ] : undefined }
                             onChange={ onColorChange } />

                <ToggleButtonGroup size="small" exclusive value={ style.align }
                                   onChange={ ( _event : React.MouseEvent<HTMLElement>, value : SvgDocument.TextStyle[ "align" ] | null ) : void => onAlignChange( value ) }>
                    <ToggleButton value="left"><FormatAlignLeftOutlinedIcon fontSize="small" /></ToggleButton>
                    <ToggleButton value="center"><FormatAlignCenterOutlinedIcon fontSize="small" /></ToggleButton>
                    <ToggleButton value="right"><FormatAlignRightOutlinedIcon fontSize="small" /></ToggleButton>
                    <ToggleButton value="justify"><FormatAlignJustifyOutlinedIcon fontSize="small" /></ToggleButton>
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
