//
import React from 'react';
import { JSX } from "react";

//
import Box from '@mui/material/Box';
import { Button, Card, CardActions, CardContent, LinearProgress, Stack, Typography } from '@mui/material';

// icons
import ErrorIcon from '@mui/icons-material/Error';

//
import AppModel from '@model/AppModel';
import { StringUtils } from '@repo/common';


export function ErrorPage( props : ErrorPage.Props ) : JSX.Element
{
    const appmodel : AppModel = AppModel.instance();
    
    const [countdown,setCountdown]  = React.useState< number >( 5 );
    const timer                     = React.useRef< ReturnType<typeof setInterval> | null >( null );

    //    
    React.useEffect( () => componentLoaded(), [] );
    React.useEffect( () => () => componentUnLoaded(), [] );
    React.useEffect( countdownChanged, [countdown] );

    ///////////////////////////////////////////////////////////////////////////////////
    function componentLoaded() : void
    {
        timer.current = setInterval( updateTimer, 1000 );
    }

    ///////////////////////////////////////////////////////////////////////////////////
    function componentUnLoaded() : void
    {
        if( timer.current )clearInterval( timer.current );
    }

    ///////////////////////////////////////////////////////////////////////////////////
    function updateTimer() : void
    {
        setCountdown( prev => prev - 1 );
    }

    ///////////////////////////////////////////////////////////////////////////////////
    function countdownChanged() : void
    {
        if( countdown < 0 )onRedirect();
    }

    ///////////////////////////////////////////////////////////////////////////////////
    function onRedirect() : void
    {
        appmodel.goto( props.redirect ? props.redirect : "/" );
    }

    return (
        <Box sx={ { p:4, display: 'flex', justifyContent: 'center', alignItems: 'top' }}>
            <Card variant="outlined" sx={{ minWidth: 275, maxWidth: "75%" }}>
                <CardContent>
                    <Stack spacing={2} sx={{alignItems:"center"}} >
                        <ErrorIcon color="primary" sx={{ fontSize: 64 }} />
                        <Typography>{"Unable to locate page."}</Typography>
                        <Typography>{ StringUtils.format( "Redirecting to in {0} seconds.", countdown ) }</Typography>
                        <Box sx={{ width: '100%' }}>
                            <LinearProgress variant="determinate" value={ ( countdown / 5 ) * 100 } />
                        </Box>
                        
                    </Stack>
                </CardContent>
                <CardActions sx={{ display: "block", justifyContent: "center" }}>
                    <Button variant="outlined" fullWidth onClick={onRedirect}>{ "Go There Now" }</Button>
                </CardActions>
            </Card>
            
        </Box>
        
    );
}

////////////////////////////////////////////////////////////////////////////////////////////////
/**
 * Error page if the user tries to go to a page that does not exist. 
 *
 * @param redirect Url to re-direct to after the user has been informed of the problem.
 */
export namespace ErrorPage
{
    export interface Props
    {
        redirect : string;
    }
}

export default ErrorPage;
// eof