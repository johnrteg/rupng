//
import React from 'react';
import { JSX } from "react";
import { Box, Chip } from '@mui/material';


export function ChipList( props : ChipList.Props ) : JSX.Element | null
{
    return <Box sx={{
                            display: 'flex',
                            flexWrap: 'wrap',
                            gap: 0.5,
                            alignItems: 'center',
                            width: '100%',
                            px: 0.5, pt: 0.5
                        }}>
                        { props.value.map( ( id : string, index : number ) => { return <Chip key={ index.toString() } label={ id } size="small" variant={ props.variant }  /> } ) }
                        </Box>
}

export namespace ChipList
{
    export interface Props
    {
        value      : Array<string>;
        variant    : "outlined" | "filled";
    }
}

export default ChipList;
// eof