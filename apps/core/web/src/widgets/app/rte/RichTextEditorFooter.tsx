//
import React from 'react';
import { JSX } from "react";

import { Theme, useTheme } from '@mui/material/styles';
import { Box, CircularProgress, Stack, Typography } from '@mui/material';


import { Editor } from '@tiptap/react';

import { StringUtils } from '@repo/common';

import Segments     from '@utils/Segments';
import Pusher       from '@widgets/core/Pusher';



function RichTextEditorFooter( props : RichTextEditorFooter.Props ) : JSX.Element | null
{
    const theme : Theme = useTheme();

    const [nchars, setNchars]                   = React.useState< number >( 0 );
    const [threshold, setThreshold]             = React.useState< string >( "" );
    const [unicodeCount, setUnicodeCount]       = React.useState< string >( "" );

    //
    React.useEffect( () => componentLoaded(), [] );
    React.useEffect( () => () => componentUnloaded(), [] );
    React.useEffect( onChange, [props.editor?.getText(),props.thresholds,props.additionalTextCount] ); // capture programmed changes

    ///////////////////////////////////////////////////////////////////////////////////////////////////
    function componentLoaded() : void
    {
        if( props.editor )
        {
            //props.editor.on('update', onChange ); // remove eventually if getText() listeners works
        }
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////
    function componentUnloaded() : void
    {
        if( props.editor )
        {
            //props.editor.off('update', onChange );
        }
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////
    function onChange() : void
    {
        //console.log('onChange');
        let len : number = props.editor ? props.editor.getText().length : 0;
        if( props.additionalTextCount !== undefined )
        {
            len += props.additionalTextCount.length;
        }

        // determine character change passed a new threshold
        if( props.editor && props.thresholds !== undefined )
        {
            let text : string = props.editor.getText();
            if( props.additionalTextCount !== undefined )
            {
                text += props.additionalTextCount;
            }

            const new_threshold : string = props.thresholds.in( text );
            setThreshold( new_threshold );
        }
        else
        {
            setThreshold( "" );
        }
        setNchars( len );

        if( props.editor && props.showUnicodeCount !== undefined && props.showUnicodeCount )
        {
            setUnicodeCount( StringUtils.format( "Unicode Characters: {0}", StringUtils.countUnicodeChars( props.editor.getText() ) ) );
        }
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////
    function PercentChars() : number
    {
        return props.maxChars > 0 ? Math.min( (nchars/props.maxChars)*100, 100 ): 0;
    }

    return <Box
            sx={{
                border: '1px solid ' + ( theme.palette.mode === 'light' ? theme.darken( theme.palette.divider, 0.5 ) : theme.lighten( theme.palette.divider, 0.5 ) ),
                borderTopLeftRadius     : 0,
                borderTopRightRadius    : 0,
                borderBottomLeftRadius  : 6,
                borderBottomRightRadius : 6,
                borderTop: 'none',
                mb: 0,                      // margin-bottom to separate from the editor box
                p: 0.5,                     // padding inside the menu bar
                background: theme.palette.background.default
            }}
        >
            <Stack direction="row" sx={ { p : 0 } } >
                <Typography variant="caption" sx={ { pl : 1, pt: 0, color: theme.palette.text.primary } } >{ unicodeCount }</Typography>
                <Pusher />
                <Typography variant="caption" sx={ { pl : 0, pr : 4, pt: 0, color: theme.palette.text.primary } } >{ threshold }</Typography>
                <Typography variant="caption" sx={ { pl : 0, pr: 0.5, pt: 0, color: theme.palette.text.primary } } >{ "Characters: " + nchars + " / " + props.maxChars }</Typography>
                <CircularProgress variant="determinate"
                                    size="20px"
                                    color={ nchars <= props.maxChars ? "primary" : "error" }
                                    sx={ { pl: 1, mt:0.3 } }
                                    thickness={ 8 }
                                    value={ props.maxChars > 0 ? PercentChars() : 0 } />
            </Stack>
        </Box>;
}



export namespace RichTextEditorFooter
{

    export interface Props
    {
        editor                  : Editor | null;
        maxChars                : number;
        thresholds?             : Segments;
        showUnicodeCount?       : boolean;
        additionalTextCount?    : string;
    }
}

export default RichTextEditorFooter;
// eof