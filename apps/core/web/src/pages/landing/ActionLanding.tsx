import AppModel from "@model/AppModel";
//
import React from 'react';
import { JSX } from "react";

import { Box, Button, CircularProgress, Paper, Stack, Typography } from "@mui/material";
import CheckCircleOutlinedIcon   from '@mui/icons-material/CheckCircleOutlined';
import ReportProblemOutlinedIcon from '@mui/icons-material/ReportProblemOutlined';

import { AuthAction, GetAuthAction, PostAuthActionConsume } from '@repo/api';
import { RestfulService } from '@repo/endpoint';

import PasswordInput from '@widgets/core/PasswordInput';

//
// ActionLanding — the SINGLE no-auth landing page for every action type (verify / reset / mfa / invite /
// unsubscribe), keyed by the `type` its route carries. Opened from an email link (`/<path>/<token>`), it
// validates the token against the auth action queue, shows type-appropriate copy, and CONSUMES the action on
// confirm (a reset also collects a new password). Renders standalone (login-like); no session required.
//
export function ActionLanding( props : ActionLanding.Props ) : JSX.Element
{
    const appmodel : AppModel = AppModel.instance();
    const config : ActionLanding.Copy = ActionLanding.COPY[ props.type ];

    const [loading,setLoading] = React.useState< boolean >( true );
    const [action,setAction]   = React.useState< AuthAction.PublicView | null >( null );
    const [done,setDone]       = React.useState< boolean >( false );
    const [busy,setBusy]       = React.useState< boolean >( false );
    const [error,setError]     = React.useState< string >( "" );
    const [password,setPassword] = React.useState< string >( "" );
    const [confirm,setConfirm]   = React.useState< string >( "" );

    // the confirm button is disabled until a valid password pair is entered (reset only)
    const ready : boolean = !config.needsPassword || ( password.length >= 8 && password === confirm );


    ////////////////////////////////////////////////////////////////////////////////////////////
    React.useEffect( componentLoaded, [] );

    // on mount: validate the token
    function componentLoaded() : void
    {
        void load();
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    async function load() : Promise<void>
    {
        setLoading( true );
        const reply : RestfulService.Reply<GetAuthAction.Response> = await appmodel.server.fetch( new GetAuthAction( props.token ) );
        if( reply.ok && reply.data )
            setAction( reply.data.action );
        else
            setError( "This link is invalid or has expired." );
        setLoading( false );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // confirm → consume the action (a reset carries the new password)
    async function onConfirm() : Promise<void>
    {
        setBusy( true );
        
        const params : Record<string, string> | undefined = config.needsPassword ? { password } : undefined;
        const reply : RestfulService.Reply<PostAuthActionConsume.Response> = await appmodel.server.fetch( new PostAuthActionConsume( props.token, { params } ) );
        if( reply.ok && reply.data )
        {
            setAction( reply.data.action );
            setDone( true );
        }
        else
            setError( "This link has expired or was already used." );
        
        setBusy( false );
    }

    
    ////////////////////////////////////////////////////////////////////////////////////////////
    function body() : JSX.Element
    {
        if( loading ) return <Stack direction="row" spacing={ 1 } sx={{ alignItems: "center", justifyContent: "center" }}><CircularProgress size={ 20 } /><Typography variant="body2" sx={{ color: "text.secondary" }}>{"Checking your link…"}</Typography></Stack>;
        if( error !== "" ) return <Stack spacing={ 2 } sx={{ alignItems: "center" }}><ReportProblemOutlinedIcon color="error" sx={{ fontSize: 44 }} /><Typography variant="body1" sx={{ textAlign: "center" }}>{ error }</Typography></Stack>;
        if( done ) return <Stack spacing={ 2 } sx={{ alignItems: "center" }}><CheckCircleOutlinedIcon color="success" sx={{ fontSize: 44 }} /><Typography variant="h6">{ config.doneTitle }</Typography><Typography variant="body2" sx={{ color: "text.secondary", textAlign: "center" }}>{ config.doneMessage }</Typography></Stack>;
        if( action && action.status !== AuthAction.Status.PENDING ) return <Stack spacing={ 2 } sx={{ alignItems: "center" }}><ReportProblemOutlinedIcon color="warning" sx={{ fontSize: 44 }} /><Typography variant="body1" sx={{ textAlign: "center" }}>{"This link has expired or was already used."}</Typography></Stack>;
        return <Stack spacing={ 2 }>
            <Typography variant="h6" sx={{ textAlign: "center" }}>{ config.title }</Typography>
            <Typography variant="body2" sx={{ color: "text.secondary", textAlign: "center" }}>{ config.description }</Typography>
            { action?.target && <Typography variant="body2" sx={{ textAlign: "center" }}>{ action.target }</Typography> }
            { config.needsPassword && <>
                <PasswordInput id="landing-pw" label={"New password"} value={ password } onChange={ setPassword } />
                <PasswordInput id="landing-pw2" label={"Confirm password"} value={ confirm } onChange={ setConfirm } />
            </> }
            <Button variant="contained" fullWidth disabled={ busy || !ready } onClick={ () => void onConfirm() }>{ busy ? "Working…" : config.button }</Button>
        </Stack>;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    return <Box sx={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", bgcolor: "background.default", p: 2 }}>
        <Paper variant="outlined" sx={{ width: "100%", maxWidth: 420, p: 4 }}>
            { body() }
        </Paper>
    </Box>;
}

export namespace ActionLanding
{
    export interface Props { token : string; type : AuthAction.Type; }

    /** Per-type page copy. */
    export interface Copy { title : string; description : string; button : string; doneTitle : string; doneMessage : string; needsPassword? : boolean; }

    export const COPY : Record<AuthAction.Type, Copy> =
    {
        [ AuthAction.Type.EMAIL_VERIFICATION ]: { title: "Verify your email", description: "Confirm this is your email address to finish setting up your account.", button: "Verify email", doneTitle: "Email verified", doneMessage: "Your email address is confirmed. You can close this window and sign in." },
        [ AuthAction.Type.PASSWORD_RESET ]:     { title: "Reset your password", description: "Choose a new password for your account.", button: "Set new password", doneTitle: "Password updated", doneMessage: "Your password has been changed. You can now sign in.", needsPassword: true },
        [ AuthAction.Type.MFA_CODE ]:           { title: "Confirm sign-in", description: "Confirm this sign-in to continue.", button: "Confirm", doneTitle: "Confirmed", doneMessage: "You're all set — return to your original window." },
        [ AuthAction.Type.ACCOUNT_INVITE ]:     { title: "Accept your invitation", description: "Accept the invitation to join.", button: "Accept invitation", doneTitle: "Invitation accepted", doneMessage: "You've joined. You can close this window and sign in." },
        [ AuthAction.Type.UNSUBSCRIBE ]:        { title: "Unsubscribe", description: "Confirm you no longer want to receive these emails.", button: "Unsubscribe", doneTitle: "You're unsubscribed", doneMessage: "You won't receive further emails of this kind." },
    };
}

export default ActionLanding;
// eof
