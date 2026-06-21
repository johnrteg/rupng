//
import React from 'react';
import { JSX } from "react";

//
import { Snackbar, Alert } from '@mui/material';

//
//
//
export function SnackAlert( props : SnackAlert.Props ) : JSX.Element
{
    ////////////////////////////////////////////////////////////////////////
    function onClose() : void
    {
        if( props.onClose != undefined )props.onClose();
    }

    // ===============================================================================================
    return  <Snackbar   open={ true }
                        autoHideDuration={5000}
                        anchorOrigin={{vertical:"top",horizontal:"center"}}
                        onClose={ () => onClose() }
                        sx={{ 
                            marginTop: props.topOffset ? `${props.topOffset}px` : '48px'
                        }}  >

                <Alert  onClose={ () => onClose() }
                        severity={ props.severity ? props.severity : "success" }
                        variant="filled"
                        sx={{ width: '100%' }} >
                        { props.message }
                </Alert>      

            </Snackbar>;
}

export namespace SnackAlert
{
    export type Severity = "success" | "error" | "info" | "warning";

    export interface Props
    {
        message     : string;
        severity?   : Severity;
        topOffset?  : number;
        onClose?    : () => void;
    }
}

export default SnackAlert;

// eof