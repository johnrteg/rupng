//
import React from 'react';
import { JSX } from "react";

import { Chip } from '@mui/material';



export function BetaChip( props : BetaChip.Props ) : JSX.Element
{

    // ============================================================================================
    return  <Chip variant="filled" label={"Beta"} color="primary" size="small"/>;

}


export namespace BetaChip
{
    export interface Props
    {
    }
}

export default BetaChip;
// eof