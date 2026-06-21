//
import React from 'react';
import { JSX } from "react";

//
import { Chip, Stack, ToggleButton } from '@mui/material';
import TextLabel from './TextLabel';

//
export function ToggleButtonInput( props: ToggleButtonInput.Props ) : JSX.Element
{
    return  <ToggleButton value={ props.id } sx={{ flex: `1 1 ${props.minWidth}px`, width: props.width }}>
                <Stack direction="column" spacing={ 2 }>
                    <Stack direction="row" spacing={ 2 }>
                        { props.icon }
                        <TextLabel bold={ true } value={ props.label } />
                        { props.chip !== undefined ? <Chip label={ props.chip } color="primary" size="small" /> : null }
                    </Stack>
                    <TextLabel variant="caption" value={ props.message } />
                </Stack>
            </ToggleButton>;
}


export namespace ToggleButtonInput
{
    export interface Props
    {
        id          : string;
        minWidth    : number;
        width       : string | number;
        icon        : JSX.Element;
        label       : string;
        message     : string;
        chip?       : string;
    }
}


export default ToggleButtonInput;

// eof