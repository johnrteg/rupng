//
import React from 'react';
import { JSX } from "react";

//
import { MuiColorInput, MuiColorInputFormat } from 'mui-color-input';

//
import { FormControlLabel, Popover, Box, Stack, IconButton, Theme, Typography, useTheme } from '@mui/material';

//
import FormatColorResetOutlinedIcon from '@mui/icons-material/FormatColorResetOutlined';
import ChecklistOutlinedIcon from '@mui/icons-material/ChecklistOutlined';

//
import { ArrayUtils } from "@repo/common";
import AppModel from "@model/AppModel";
import ButtonIcon from "./ButtonIcon";
import ButtonIconDropdown from "./ButtonIconDropdown";



//
//
//
export function ColorPicker( props : ColorPicker.Props ) : JSX.Element
{
    const theme : Theme = useTheme();
    
    const [anchorEl, setAnchorEl] = React.useState<HTMLButtonElement | null>(null);
    const [format, setFormat]     = React.useState< MuiColorInputFormat >( "rgb" );
    const [color, setColor]       = React.useState< string >( props.value );
    const [alpha, setAlpha]       = React.useState< boolean >( props.isAlphaHidden ? props.isAlphaHidden : true );
    const [disabled, setDisabled] = React.useState< boolean >( props.disabled ? props.disabled : false );
    
    const timeoutRef              = React.useRef<ReturnType<typeof setTimeout> | null>(null);

    //
    React.useEffect( doDebounce, [color] );
    React.useEffect( propColorChange, [props.value] );
    React.useEffect( propAlphaChange, [props.isAlphaHidden] );
    React.useEffect( propDisabledChange, [props.disabled] );
    React.useEffect( () => () => unMountComponent(), [] );

    ///////////////////////////////////////////////////////////////////////////////////////////////////
    function unMountComponent() : void
    {
        if( timeoutRef.current )clearTimeout( timeoutRef.current );
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////
    function doDebounce() : void
    {
        if( timeoutRef.current )clearTimeout( timeoutRef.current );
        timeoutRef.current = setTimeout( onDelay, 10 );
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////
    function onDelay() : void
    {
        timeoutRef.current = null;
        onColorChanged();
    }

    /////////////////////////////////////////////////////////////////////////
    function onClick( event: any ) : void
    {
        if( !disabled )setAnchorEl( event.currentTarget );
    }

    /////////////////////////////////////////////////////////////////////////
    function propColorChange() : void
    {
        if( color != props.value )setColor( props.value );
    }

    /////////////////////////////////////////////////////////////////////////
    function propAlphaChange() : void
    {
        if( props.isAlphaHidden != undefined && alpha != props.isAlphaHidden )
        {
            setAlpha( props.isAlphaHidden );
        }
    }

    /////////////////////////////////////////////////////////////////////////
    function propDisabledChange() : void
    {
        if( props.disabled != undefined )
        {
            setDisabled( props.disabled );
        }
    }

    /////////////////////////////////////////////////////////////////////////
    function onClose() : void
    {
        setAnchorEl(null);
    }

    /////////////////////////////////////////////////////////////////////////
    function onColorChanged() : void
    {
        if( color != props.value )props.onChange( color );
    }

    /////////////////////////////////////////////////////////////////////////
    function onColorClicked( color : string ) : void
    {
        props.onChange( color );
        onClose();
    }

    ////////////////////////////////////////////////////////////////////////
    function onFormatChanged( format : MuiColorInputFormat ) : void
    {
        setFormat( format );
    }

    ////////////////////////////////////////////////////////////////////////
    function onClear() : void
    {
        if( props.onClear )props.onClear();
        onClose();
    }

    /////////////////////////////////////////////////////////////////////////////////////////////////////
    // render a set of colors as chunked swatch rows (shared by the standard choices + each named palette group)
    function swatchRows( colors : Array<string>, keyPrefix : string ) : Array<JSX.Element>
    {
        // divide the set of colors into chunks (row width depends on which trailing controls are present)
        const nbr : number = props.onClear && props.formats ? 11 : props.onClear || props.formats ? 10 : 8;
        const chunks : Array< Array<string> > = ArrayUtils.chunkArray<string>( colors, nbr );

        return chunks.map( ( row : Array<string>, index : number ) =>
        {
            return <Stack direction="row" key={ keyPrefix + '-' + index }>
                { row.map( ( item: string ) => {
                     return <Box    key={ item } onClick={ ()=>onColorClicked( item ) }
                            sx={{   border: 2,
                                    borderColor: props.value == item ? "#ffffff" : item,
                                    borderRadius: 0,
                                    bgcolor: item,
                                    width:24,
                                    height: 24 }}
                    />
                } ) }
            </Stack>
        } );
    }

    /////////////////////////////////////////////////////////////////////////////////////////////////////
    // the standard predefined palette (backwards-compatible with the original single-palette behavior)
    function predefinedColors() : Array<JSX.Element>
    {
        return swatchRows( props.choices, "standard" );
    }

    /////////////////////////////////////////////////////////////////////////////////////////////////////
    // the palette groups to offer: the ACTING account's brand palette (cached in AccountService, auto-included
    // app-wide) followed by any the caller passed (e.g. the campaign palette in a campaign context). Empty
    // groups are dropped by paletteGroup.
    function effectivePalettes() : Array<ColorPicker.Palette>
    {
        const accountColors : Array<string> = AppModel.instance().account.palette ?? [];
        const groups : Array<ColorPicker.Palette> = [];
        if( accountColors.length > 0 ) groups.push( { label: "Account", colors: accountColors } );
        ( props.palettes ?? [] ).forEach( ( palette : ColorPicker.Palette ) : void => { groups.push( palette ); } );
        return groups;
    }

    /////////////////////////////////////////////////////////////////////////////////////////////////////
    // a NAMED palette group (Account / Campaign / …) — a small caption over its swatch rows. Skipped when empty.
    function paletteGroup( palette : ColorPicker.Palette ) : JSX.Element | null
    {
        if( palette.colors.length === 0 ) return null;
        return <Stack direction="column" key={ 'pal-' + palette.label } sx={{ width: "100%", pt: 0.5 }}>
                    <Typography variant="caption" sx={{ px: 0.5, color: "text.secondary" }}>{ palette.label }</Typography>
                    { swatchRows( palette.colors, 'pal-' + palette.label ) }
               </Stack>;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////////////
    function formats() : Array<ButtonIconDropdown.Choice>
    {
        let choices : Array<ButtonIconDropdown.Choice> = [];

        if( props.formats )
        {
            props.formats.forEach( ( fmt : string ) => { choices.push( { value: fmt, label: fmt.toUpperCase() } ) } );
        }
    
        return choices;
    }

    /////////////////////////////////////////////////////////////////////////////////////////////////////
    function baseControl() : JSX.Element
    {
        return props.icon ?
        <IconButton
                component="label"
                sx={{
                            minWidth        : 0,
                            width           : 40,
                            height          : 40,
                            padding         : 0.5,
                            borderRadius    : 0.5,
                            lineHeight      : 1,
                            display         : "flex",
                            alignItems      : "center",
                            justifyContent  : "center",
                            bgcolor         : props.selected != undefined && props.selected ? "grey.300" : "transparent",
                            color           : "grey.800",
                            boxShadow       : "none",
                            borderWidth     : 1,
                            border          : "1px solid",           // Set border first
                            borderColor     : theme.palette.divider,       // Set borderColor last for override
                            '&:hover': { bgcolor: "grey.200", boxShadow: "none" },
                                
                    }}
                    onClick={ onClick }
                >
                <Stack direction="column" spacing={0.25} sx={{alignItems:"center"}} >
                    { props.icon }
                    <Box  onClick={ onClick }
                                        sx={{   marginLeft      : 0,
                                                borderRadius    : 0,
                                                boxShadow       : "none",
                                                bgcolor         : props.value,
                                                width           : 30,
                                                height          : 5,
                                                borderWidth     : 1,
                                                border          : "1px solid",           // Set border first
                                                borderColor     : theme.palette.divider,       // Set borderColor last for override
                                            }} />
                </Stack>
                
            </IconButton>
        
        : <FormControlLabel
                    disabled={ props.disabled != null ? props.disabled : false }
                    labelPlacement="start"
                    sx={ { paddingTop:1 } }
                    label={ props.label }
                    control={ <Box  onClick={ onClick }
                                    sx={{   marginLeft      : 1,
                                            borderRadius    : 1,
                                            boxShadow       : "none",
                                            bgcolor         : props.value,
                                            width           : 38,
                                            height          : 38,
                                            borderWidth     : 1,
                                            border          : "1px solid",           // Set border first
                                            borderColor     : "grey.400",       // Set borderColor last for override
                                        }} />
                            } 
                />;
    }


    // ===============================================================================================
    return  <section>
                { baseControl() }

                <Popover
                        id={props.id+"_pop"}
                        open={ Boolean(anchorEl) }
                        anchorEl={anchorEl}
                        onClose={onClose}
                        anchorOrigin={{ vertical: 'top', horizontal: 'right' }}
                    >
                    <Stack direction="column" spacing={0} sx={{alignItems:"center"}}>

                        <Stack direction="row" >
                            <MuiColorInput  value={ color }
                                            format={ format }
                                            fallbackValue="#ffffffff"
                                            disablePopover={ false }
                                            isAlphaHidden={ alpha }
                                            onChange={ setColor } />
                                

                            { props.formats || props.onClear  ?
                                <Stack direction="row" sx={{alignItems:"center"}}>
                                    
                                    { props.formats ?
                                    <ButtonIconDropdown id="format"
                                                        label={ "Format" }
                                                        icon={ <ChecklistOutlinedIcon /> }
                                                        choices={ formats() }
                                                        selected={ format }
                                                        onChange={ ( value : string ) => onFormatChanged( value as MuiColorInputFormat ) } />
                                    : null }

                                    { props.onClear ?
                                    <ButtonIcon id="clear"
                                                label="Clear"
                                                icon={ <FormatColorResetOutlinedIcon /> }
                                                onClick={ onClear } />
                                    : null }


                                </Stack> : null }


                        </Stack>
                                
                        { /* ---------------- named palettes (Account auto-included + any passed, e.g. Campaign) --------------- */ }
                        { effectivePalettes().map( ( palette : ColorPicker.Palette ) => paletteGroup( palette ) ) }

                        { /* ---------------- standard predefined palette --------------- */ }
                        { props.choices.length > 0 ?
                            <Stack direction="column" sx={{ width: "100%", pt: 0.5 }}>
                                { effectivePalettes().length > 0 ? <Typography variant="caption" sx={{ px: 0.5, color: "text.secondary" }}>{"Standard"}</Typography> : null }
                                { predefinedColors() }
                            </Stack> : null }
                                 
                    </Stack>
                </Popover>
            </section>;

}


export namespace ColorPicker
{
    export type Formats = "hex" | "rgb" | "hsv" | "hsl";

    //
    //
    //
    export interface Props
    {
        id              : string;
        label           : string;
        disabled?       : boolean
        value           : string;
        isAlphaHidden?  : boolean;
        icon?           : JSX.Element;
        choices         : Array<string>;
        palettes?       : Array<ColorPicker.Palette>;   // named palette groups (e.g. Account / Campaign) shown above Standard
        formats?        : Array<ColorPicker.Formats>;
        selected?       : boolean;
        onChange        : ( color : string ) => void;
        onClear?        : () => void;
    }

    /** A named palette group offered in the picker (label + ordered hex swatches). */
    export interface Palette
    {
        label  : string;
        colors : Array<string>;
    }



    // https://mui.com/material-ui/customization/color/#picking-colors
    export const COLORS      : Array<string> = ["#f44336","#e91e63","#9c27b0","#673ab7","#3f51b5","#2196f3","#03a9f4","#00bcd4","#009688","#4caf50","#8bc34a","#cddc39","#ffeb3b","#ffc107","#ff9800","#ff5722"];
    export const GREYS : Array<string> = ["#fafafa","#f5f5f5","#eeeeee","#e0e0e0","#bdbdbd","#9e9e9e","#757575","#616161","#424242","#212121"];
}


export default ColorPicker;
// eof