import AppModel from "@model/AppModel";
//
import React from 'react';
import { JSX } from "react";

import { Box, Button, Stack, Typography } from "@mui/material";
import KeyOutlinedIcon    from '@mui/icons-material/KeyOutlined';
import LogoutOutlinedIcon from '@mui/icons-material/LogoutOutlined';

import { startRegistration, type PublicKeyCredentialCreationOptionsJSON } from "@simplewebauthn/browser";

import Page         from "@pages/common/Page";
import AppRouter    from "@main/AppRouter";
import { Access, RestfulService } from "@repo/endpoint";
import { PostPasskeyRegisterOptions, PostPasskeyRegisterVerify } from "@repo/api";

export function Dashboard( props : Dashboard.Props ) : JSX.Element
{
    const appmodel : AppModel = AppModel.instance();

    const [status,setStatus]  = React.useState< string >( "" );
    const [busy,setBusy]      = React.useState< boolean >( false );

    //
    React.useEffect( () => componentLoaded(), [] );

    ////////////////////////////////////////////////////////////////////////////////////////////
    function componentLoaded() : void
    {
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // enrol a passkey for the signed-in user: get creation options, run the browser ceremony, verify.
    // Requires a session (the Authorization bearer set at login).
    async function onAddPasskey() : Promise<void>
    {
        setStatus( "" );
        setBusy( true );
        try
        {
            const optionsReply : RestfulService.Reply<PostPasskeyRegisterOptions.Response> = await appmodel.server.fetch( new PostPasskeyRegisterOptions() );
            if( !optionsReply.ok || !optionsReply.data )
            {
                setStatus( "Could not start passkey enrolment — are you signed in?" );
                return;
            }

            const attestation = await startRegistration( { optionsJSON: optionsReply.data.options as unknown as PublicKeyCredentialCreationOptionsJSON } );

            const verifyReply : RestfulService.Reply<PostPasskeyRegisterVerify.Response> = await appmodel.server.fetch(
                new PostPasskeyRegisterVerify( { ceremonyId: optionsReply.data.ceremonyId, response: attestation as unknown as Record<string, unknown> } ) );

            setStatus( verifyReply.ok && verifyReply.data?.verified
                ? "Passkey added — you can now sign in with it."
                : "Passkey enrolment failed." );
        }
        catch( err )
        {
            appmodel.log.warn( "passkey.enrol", err );
            setStatus( "Passkey enrolment was cancelled or unavailable." );
        }
        finally
        {
            setBusy( false );
        }
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    function onSignOut() : void
    {
        appmodel.clearSession();
        appmodel.goto( AppRouter.Route.LOGIN );
    }

    return <Page minAccess={ Access.AccountRole.USER }>
        <Box sx={{ p: 3 }}>
            <Stack direction="column" spacing={ 2 } sx={{ maxWidth: 420 }}>
                <Typography variant="h5">Dashboard</Typography>

                <Button variant="outlined" startIcon={ <KeyOutlinedIcon /> } disabled={ busy } onClick={ () => void onAddPasskey() }>
                    Add a passkey
                </Button>

                { status !== "" && <Typography variant="body2" sx={{ color: "text.secondary" }}>{ status }</Typography> }

                <Button variant="text" color="inherit" startIcon={ <LogoutOutlinedIcon /> } onClick={ onSignOut } sx={{ alignSelf: "flex-start" }}>
                    Sign out
                </Button>
            </Stack>
        </Box>
    </Page>;
}

export namespace Dashboard
{
    export interface Props
    {
    }
}
// eof
