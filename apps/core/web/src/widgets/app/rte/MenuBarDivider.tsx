//
import React from 'react';
import { JSX } from "react";

//
import { Divider } from '@mui/material';


export function MenuBarDivider( props : MenuBarDivider.Props ) : JSX.Element
{

    // ============================================================================================
    return  <Divider orientation="vertical" flexItem sx={ { mx: 0.5 } } />;
}

export namespace MenuBarDivider
{
    export interface Props
    { 
    }

}

export default MenuBarDivider;

// eof