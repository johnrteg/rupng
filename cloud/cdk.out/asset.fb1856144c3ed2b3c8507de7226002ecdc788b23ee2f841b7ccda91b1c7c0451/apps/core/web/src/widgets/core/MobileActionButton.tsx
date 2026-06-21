//
import React from 'react';
import { JSX } from "react";
import { Fab } from '@mui/material';


export function MobileActionButton( props : MobileActionButton.Props ) : JSX.Element
{
    return <Fab sx={ { position:'absolute', bottom: 16, right: 16 } } color="primary" onClick={ () => props.onClick() }>
                { props.icon }
            </Fab>
}

export namespace MobileActionButton
{
    export interface Props
    {
        icon : JSX.Element;
        onClick : () => void;
    }
}

export default MobileActionButton;
// eof