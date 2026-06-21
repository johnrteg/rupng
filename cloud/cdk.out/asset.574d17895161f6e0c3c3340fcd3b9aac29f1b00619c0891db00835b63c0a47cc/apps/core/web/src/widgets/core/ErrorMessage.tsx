//
import React from 'react';
import { JSX } from "react";

//
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';

//
import ErrorIcon from '@mui/icons-material/Error';


export function ErrorMessage( props: ErrorMessage.Props ) : JSX.Element | null
{
    //
    //
    //
    return ( props.value !== "" ? <Stack direction="row" spacing={1}>
                <ErrorIcon color="error"/>
                <Typography color="error">{props.value}</Typography>
            </Stack> : null );  
}

///////////////////////////////////////////////////////////////////////////////////////////////
/**
 * Displays an error message
 *
 * @param value The error message to be displayed
 * @example <ErrorMessage value={ error } />
 */
export namespace ErrorMessage
{
    export interface Props
    {
        value       : string;
    }
}

export default ErrorMessage;
// eof