// ErrorBoundary.tsx
import React, { ReactNode } from 'react';

import ErrorOutlineOutlinedIcon from '@mui/icons-material/ErrorOutlineOutlined';
import { Box, Button, Divider, Typography } from '@mui/material';
import Page from '@pages/common/Page';
import TextLabel from '@widgets/core/TextLabel';


interface ErrorBoundaryProps
{
    children: React.ReactNode;
}

interface ErrorBoundaryState
{
    hasError        : boolean;
    error?          : Error;
    errorInfo?      : React.ErrorInfo;
}

const RELOAD_KEY : string = 'error_boundary_reloaded';

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState>
{
    constructor( props: ErrorBoundaryProps )
    {
        super( props );
        this.state = { hasError: false };

        // Clear the reload flag on successful mount so future errors on new pages
        // still get the one free auto-reload.
        //sessionStorage.removeItem( RELOAD_KEY );
    }

    //////////////////////////////////////////////////////////////////////////////////////////////////////////////
    static getDerivedStateFromError( error: Error ) : any
    {
        return { hasError: true, error };
    }

    //////////////////////////////////////////////////////////////////////////////////////////////////////////////
    public componentDidCatch( error: Error, info: React.ErrorInfo ) : void
    {
        this.setState({ errorInfo: info });
        console.error( 'ErrorBoundary tripped', error );
        console.error( 'ErrorBoundary trace', info );

        /*
        if ( !sessionStorage.getItem( RELOAD_KEY ) )
        {
            // First error — likely a lazy-load chunk failure. Reload once automatically.
            sessionStorage.setItem( RELOAD_KEY, '1' );
            window.location.reload();
        }
        */
        // If already reloaded, fall through and show the error UI.
    }

    //////////////////////////////////////////////////////////////////////////////////////////////////////////////
    public render() : ReactNode
    {
        if ( this.state.hasError )
        {
            return <Page  >
                        <Box sx={{
                                minHeight: '80vh',
                                display: 'flex',
                                flexDirection: 'column',
                                alignItems: 'center',
                                justifyContent: 'center',
                                textAlign: 'center'
                            }}
                        >
                            <ErrorOutlineOutlinedIcon fontSize="large" color="error"/>
                            <TextLabel variant="h4" value={ "An Error Occured.  Please refresh the page." } />
                            <TextLabel value={ "If this happens again, please contact support with the steps to reproduce the issue." } />

                            <Box sx={ { p: 2, m: 2,
                                        backgroundColor: "#e9e9e9",
                                        border: '1.5px solid',
                                        borderColor: 'divider',
                                        borderRadius: 2,
                                        boxShadow: 0,
                                        maxWidth: '90vw',
                                        overflowX: 'auto',
                                        textAlign: 'left' } }>
                                <Typography variant="subtitle2" sx={{color:"error"}}>{ this.state.error?.message }</Typography>

                                { window.location.hostname === 'localhost' && <>
                                    <Divider sx={{ my: 1 }} />
                                    <Typography variant="caption" component="pre" sx={{ whiteSpace: 'pre-wrap', display: 'block' }}>
                                        { this.state.error?.stack ?? 'No stack available' }
                                    </Typography>
                                </> }

                                { this.state.errorInfo && <>
                                    <Divider sx={{ my: 1 }} />
                                    <Typography variant="caption" component="pre" sx={{ whiteSpace: 'pre-wrap', display: 'block' }}>
                                        { this.state.errorInfo.componentStack?.split( '\n' ).slice( 0, 12 ).join( '\n' ) }
                                    </Typography>
                                </> }
                            </Box>

                            <Button variant="outlined" onClick={ () => window.location.reload() }>{ "Refresh" }</Button>
                            
                        </Box>
                    </Page>;
        }
        return this.props.children;
    }
}

export default ErrorBoundary;

// eof