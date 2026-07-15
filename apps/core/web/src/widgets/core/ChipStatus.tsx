//
import React from 'react';
import { JSX } from "react";

import { Chip, Theme, useTheme } from '@mui/material';
import Colors from '../../utils/Colors';



export function ChipStatus( props : ChipStatus.Props ) : JSX.Element
{
    const theme : Theme = useTheme();

    
    // ============================================================================================
    return  <Chip   label={ props.label }
                    size={ props.size ? props.size : "medium" }
                    icon={ props.icon }
                    sx={{   backgroundColor: Colors.bgColor( props.status, theme ),
                            color: Colors.textColor( props.status, theme ),
                            "& .MuiChip-icon": { color: Colors.textColor( props.status, theme ) } }} />;

}

////////////////////////////////////////////////////////////////////////////////////////////////
/**
 * Displays a chip by a uniform status that corresponds to a theme color.
 *
 * @param label Label of the chip.
 * @param status Color status.
 */
export namespace ChipStatus
{
    export interface Props
    {
        label   : string;
        status  : Colors.Status;
        size?   : "small" | "medium";
        icon?   : JSX.Element;
    }
}

export default ChipStatus;
// eof