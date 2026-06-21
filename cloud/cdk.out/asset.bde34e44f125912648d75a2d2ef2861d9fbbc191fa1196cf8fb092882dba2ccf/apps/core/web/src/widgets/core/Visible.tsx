//
import React from 'react';
import { JSX } from "react";
import { Box } from '@mui/material';


export function Visible( props : Visible.Props ) : JSX.Element
{
    return <Box sx={ { display: props.visible ? 'contents' : 'none' } }>{ props.children }</Box>;
}

export namespace Visible
{
    export interface Props
    {
        visible   : boolean;
        children  : JSX.Element | Array<JSX.Element>;
    }
}

export default Visible;
// eof