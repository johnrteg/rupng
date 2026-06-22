//
import React from 'react';
import { JSX } from "react";


import { Box } from '@mui/material';

//
export function HtmlInput( props: HtmlInput.Props ) : JSX.Element
{

    return  <Box
                sx={{
                        backgroundColor: props.backgroundColor ?? undefined,
                        color: props.textColor ?? undefined,

                        overflowX: 'hidden',
                        '& img': { maxWidth: '100%', height: 'auto' },
                        '& table': { maxWidth: '100%' },
                        '& pre': { overflowX: 'auto' },

                                // Remove default browser paragraph margins at the top/bottom of the bubble,
                                // but keep a little spacing *between* paragraphs.
                                '& p': { margin: 0 },
                                '& p + p': { marginTop: '0.5em' },
                    }}
                    dangerouslySetInnerHTML={{ __html: props.value }}
                />;
}

export namespace HtmlInput
{
    export interface Props
    {
        id          : string;
        value       : string;
        backgroundColor ?     : string;
        textColor?  : string;
    }
}

export default HtmlInput;

// eof