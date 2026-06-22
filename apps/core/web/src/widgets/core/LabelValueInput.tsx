//
import React from 'react';
import { JSX } from "react";
import { Theme, useTheme } from '@mui/material/styles';

//
import { Stack } from '@mui/material';
import TextLabel from './TextLabel';


export function LabelValueInput( props : LabelValueInput.Props ) : JSX.Element
{
    const theme : Theme = useTheme();

    return  <Stack direction="row" spacing={ 2 }>
                <TextLabel value={ props.label + ":" } color="text.disabled" />
                <TextLabel value={ props.value } />
            </Stack>;

}


/**
 * TextLabel component wraps Typography with simplier argument to manage display.
 *
 * @param props.label - Label to display
 * @param props.value - String to dsiplay
 * @param props.padding - left, right, top, and bottom padding
 */
export namespace LabelValueInput
{


    export interface Props
    {
        label       : string;
        value       : string;
        padding?    : { left?: number, top?: number, right?: number, bottom?: number };
    }

}

export default LabelValueInput;

// eof