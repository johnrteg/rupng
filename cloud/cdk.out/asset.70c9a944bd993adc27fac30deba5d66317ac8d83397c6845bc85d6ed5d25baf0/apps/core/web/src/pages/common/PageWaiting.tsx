//
import React from 'react';
import { JSX } from "react";

//
import Box from '@mui/material/Box';
import { CircularProgress } from '@mui/material';

export function PageWaiting( props : PageWaiting.Props ) : JSX.Element
{

    
    // ============================================================================================
    return (
        <Box sx={{
                    minHeight: '100vh',
                    display: 'flex',
                    justifyContent: 'center',
                    alignItems: 'center',
                }} >
            <CircularProgress />
        </Box>
        
    );
}

export namespace PageWaiting
{
    export interface Props
    {
    }
}

export default PageWaiting;
// eof