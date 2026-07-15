//
import { Editor, JSONContent } from '@tiptap/core';
import React from 'react';
import { JSX } from "react";

//
import { Box, IconButton, Popover, Stack, Theme, Tooltip, useTheme } from '@mui/material';

//
import FormatColorResetOutlinedIcon from '@mui/icons-material/FormatColorResetOutlined';
import FormatColorTextOutlinedIcon from '@mui/icons-material/FormatColorTextOutlined';

//
import ButtonIcon from '@widgets/core/ButtonIcon';


export function ColorButtonInput( props : ColorButtonInput.Props ) : JSX.Element
{
    const theme : Theme = useTheme();

    const [anchorEl, setAnchorEl]       = React.useState<null | HTMLElement>(null);
    const [colors, setColors]           = React.useState< Array<string> >( [] );
    //
    //React.useEffect( () => componentLoaded(), [] );

    ////////////////////////////////////////////////////////////////////////////////////////////////////////////
    //function componentLoaded() : void
    //{ 
    //}

    ////////////////////////////////////////////////////////////////////////////////////////////////////////////
    function onClick(event: React.MouseEvent<HTMLElement>)
    {
        const current_colors : Array<string> = getColors();
        //console.log( 'ColorButtonInput', colors );
        setColors( current_colors );
        setAnchorEl( event.currentTarget );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////////////////////
    function onClose()
    {
        setAnchorEl( null );
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////
    function getColors() : Array<string>
    { 
        if( !props.editor )return [];
        const doc : JSONContent = props.editor.getJSON();
        //console.log(doc);

        const current_colors : Set<string> = new Set<string>();

        // not ideal
        function scan(node: any)
        {
            // Check marks for color
            if( node.marks )
            {
                node.marks.forEach((mark: any) => {
                    if( mark.attrs && mark.attrs.color )
                    {
                        current_colors.add(mark.attrs.color);
                    }
                });
            }
            // Check node attrs for color (e.g., textStyle extension)
            if( node.attrs && node.attrs.color )
            {
                current_colors.add(node.attrs.color);
            }
            
            // Recurse into content
            if( node.content )node.content.forEach( scan );
        }

        scan(doc);  // entry point
        return Array.from(current_colors);  
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////////////
    function onClear()
    {
        props.editor.chain().focus().unsetColor().run();
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////////////
    function onColorClick( color : string ) : void
    {
        props.editor.chain().focus().setColor( color ).run();
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////////////
    function colorBox( color : string ) : JSX.Element
    {
        return <Box key={color} onClick={ ()=>onColorClick(color) }
                    sx={{ border: 2, borderColor: ( theme.palette.mode === 'light' ? theme.darken( theme.palette.divider, 0.5 ) : theme.lighten( theme.palette.divider, 0.5 ) ),
                    cursor: "pointer", borderRadius: 0, bgcolor: color, width:24, height: 24 }} />
    }


    // ============================================================================================
    return  <section>
                <Tooltip title={ props.label } arrow>
                    <IconButton
                        component="label"
                        sx={{
                                minWidth: 0,
                                width: 40,
                                height: 40,
                                padding         : 0.5,
                                borderRadius    : 0.5,
                                lineHeight      : 1,
                                display         : "flex",
                                alignItems      : "center",
                                justifyContent  : "center",
                                bgcolor         : props.editor.getAttributes('textStyle').color ? ( theme.palette.mode === 'light' ? theme.darken( theme.palette.divider, 0.5 ) : theme.lighten( theme.palette.divider, 0.5 ) ) : "transparent",
                                color           : theme.palette.text.secondary,
                                boxShadow       : "none",
                                borderWidth     : 1,
                                border          : "1px solid",           // Set border first
                                borderColor     : ( theme.palette.mode === 'light' ? theme.darken( theme.palette.divider, 0.5 ) : theme.lighten( theme.palette.divider, 0.5 ) ),
                                '&:hover': { bgcolor: ( theme.palette.mode === 'light' ? theme.darken( theme.palette.divider, 0.25 ) : theme.lighten( theme.palette.divider, 0.25 ) ), boxShadow: "none" },
                                    
                            }}
                            onClick={ onClick }
                        >
                        <FormatColorTextOutlinedIcon />
                </IconButton>
            </Tooltip>

            <Popover
                open={ Boolean( anchorEl ) }
                anchorEl={ anchorEl }
                onClose={ onClose }
                sx={ { p : 0 } }
                anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
            >
                <Box sx={{ p: 0.5, display: "flex", flexDirection: "column", gap: 1 }}>
                    <input
                        type="color"
                        onInput={ event => onColorClick( event.currentTarget.value ) }
                        value={ props.editor.getAttributes('textStyle').color || '#000000' }
                        data-testid="setColor"
                        style={{
                            width: 24,
                            height: 24,
                            cursor: "pointer",
                            border: "none",
                            background: "none",
                            padding: 0,
                        }}
                    />
                    {/* ------------------------------- Add other elements here ----------------------- */}
                    <ButtonIcon id="clear" label="Clear" icon={ <FormatColorResetOutlinedIcon /> } onClick={ onClear } />
                    { <Stack direction="row" spacing={ 0.2 } >
                        { colors.map( ( color: string, index: number ) => { return colorBox( color ) } ) }
                      </Stack>
                    }
                </Box>
            </Popover>
        </section>;

}

export namespace ColorButtonInput
{
    export interface Props
    {
        id      : string;
        label   : string;
        editor  : Editor;
    }
}

export default ColorButtonInput;

// eof