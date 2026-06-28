//
import React from 'react';
import { JSX } from "react";

//
import { Box, Paper, Stack, Button, Divider } from '@mui/material';
import { ToggleButton, ToggleButtonGroup } from '@mui/material';

//
import ArrowBackIcon        from '@mui/icons-material/ArrowBack';

//
import { EmailUtils } from "@repo/common";

//
import AppModel             from "@model/AppModel";
import AppRouter            from "@main/AppRouter";

//
import Page                 from "@pages/common/Page";

//
import ImageInput           from "@widgets/core/ImageInput";
import EmailInput           from "@widgets/core/EmailInput";
import TelephoneInput       from "@widgets/core/TelephoneInput";
import TextLabel            from "@widgets/core/TextLabel";
import LinkButton           from "@widgets/core/LinkButton";
import Show                 from "@widgets/core/Show";



//
// Forgot PASSWORD — request a reset link/code for a known identifier. Enumeration-neutral: the
// confirmation is the same whether or not the contact exists. The actual reset (entering a new
// password from a token) is a separate page. STUBBED — see apps/core/auth/specs/ACCESS-FLOWS.md.
//
export function ForgotPassword( props : ForgotPassword.Props ) : JSX.Element
{
    const appmodel : AppModel = AppModel.instance();

    const [method,setMethod]    = React.useState< ForgotPassword.Method >( ForgotPassword.Method.EMAIL );
    const [email,setEmail]      = React.useState< string >( "" );
    const [phone,setPhone]      = React.useState< string >( "" );
    const [sent,setSent]        = React.useState< boolean >( false );

    const valid : boolean = method === ForgotPassword.Method.EMAIL ? EmailUtils.isValid( email ) : appmodel.ui.locale.phoneValid( phone );

    ////////////////////////////////////////////////////////////////////////////////////////////
    function onSubmit( event : React.FormEvent<HTMLFormElement> ) : void
    {
        event.preventDefault();
        if( !valid ) return;
        // TODO: POST /api/auth/v1/recover/password — send a reset link/code; user then sets a new password.
        appmodel.log.info( "forgot-password", { method, email, phone } );
        setSent( true );
    }


    // ==================================================================================================================================
    return <Page noNotify={ true }>
                <Box sx={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", p: 2 }}>
                    <Paper elevation={ 3 } sx={{ p: 4, width: "100%", maxWidth: 420, borderRadius: 2 }}>
                        <Stack direction="column" spacing={ 2 }>

                            {/* same whitelabel banner as the login page */}
                            <ImageInput id="forgot-password-banner"
                                        value={ appmodel.ui.getHeaderImageUrl() }
                                        alt={ appmodel.label( "page.login.banner.alt" ) }
                                        defaultSrc="/assets/banner/default.png"
                                        maxWidth={ 240 }
                                        maxHeight={ 80 }
                                        sx={{ alignSelf: "center" }} />

                            <Box sx={{ position: "relative", display: "flex", alignItems: "center", justifyContent: "center", minHeight: 40 }}>
                                <Button size="small" color="inherit" startIcon={ <ArrowBackIcon fontSize="small" /> } onClick={ () => appmodel.goto( AppRouter.Route.LOGIN ) } sx={{ position: "absolute", left: 0 }}>Back</Button>
                                <TextLabel variant="h5" align="center" value="Forgot Password" />
                            </Box>

                            <Show show={ !sent }>
                                <TextLabel align="center" value="Enter your email or phone and we'll send a link to reset your password." />

                                <Box component="form" onSubmit={ onSubmit }>
                                    <Stack direction="column" spacing={ 2 }>
                                        <ToggleButtonGroup exclusive
                                                        fullWidth
                                                        size="small"
                                                        value={ method }
                                                        onChange={ ( _e : React.MouseEvent, value : ForgotPassword.Method | null ) => { if( value ) setMethod( value ); } }>
                                            <ToggleButton value={ ForgotPassword.Method.EMAIL }>Email</ToggleButton>
                                            <ToggleButton value={ ForgotPassword.Method.PHONE }>Phone</ToggleButton>
                                        </ToggleButtonGroup>

                                        <Show show={ method === ForgotPassword.Method.EMAIL }>
                                            <EmailInput id="forgot-password-email" label="Email" value={ email } autoComplete="email" onChange={ setEmail } />
                                        </Show>
                                        <Show show={ method === ForgotPassword.Method.PHONE }>
                                            <TelephoneInput id="forgot-password-phone" label="Phone" value={ phone } fullWidth autoComplete="tel" onChange={ setPhone } />
                                        </Show>

                                        <Button type="submit" variant="contained" fullWidth disabled={ !valid }>Send Reset Link</Button>
                                    </Stack>
                                </Box>
                            </Show>

                            <Show show={ sent }>
                                <TextLabel align="center" value="If that contact matches an account, we've sent a reset link. Check your email or phone." />
                            </Show>

                            <Divider />
                            <Stack direction="row" spacing={ 1 } sx={{ justifyContent: "center", alignItems: "center" }}>
                                <LinkButton label="Back to Sign In" onClick={ () => appmodel.goto( AppRouter.Route.LOGIN ) } sx={{ width: "auto" }} />
                            </Stack>

                        </Stack>
                    </Paper>
                </Box>
            </Page>;
}

export namespace ForgotPassword
{
    export enum Method
    {
        EMAIL = "email",
        PHONE = "phone",
    }

    export interface Props
    {
    }
}

export default ForgotPassword;

// eof
