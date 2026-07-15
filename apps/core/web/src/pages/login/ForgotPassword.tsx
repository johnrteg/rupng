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
import { ContactMethod, PostPasswordForgot } from "@repo/api";
import { RestfulService } from "@repo/endpoint";

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
// Forgot PASSWORD — request a reset for a known identifier. EMAIL is wired to the app-driven flow (a branded
// reset LINK sent via the email service); the new password is set on the no-auth /reset landing page. PHONE
// stays informational until the SMS rail is live. Enumeration-neutral: the confirmation is the same whether or
// not the contact exists.
//
export function ForgotPassword( props : ForgotPassword.Props ) : JSX.Element
{
    const appmodel : AppModel = AppModel.instance();

    const [method,setMethod]    = React.useState< ContactMethod >( ContactMethod.EMAIL );
    const [email,setEmail]      = React.useState< string >( "" );
    const [phone,setPhone]      = React.useState< string >( "" );
    const [sent,setSent]        = React.useState< boolean >( false );

    const valid : boolean = method === ContactMethod.EMAIL ? EmailUtils.isValid( email ) : appmodel.ui.locale.phoneValid( phone );

    ////////////////////////////////////////////////////////////////////////////////////////////
    function onSubmit( event : React.FormEvent<HTMLFormElement> ) : void
    {
        event.preventDefault();
        void submit();
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // Request the reset. EMAIL uses the app-driven flow (POST /password/forgot → a branded reset LINK via the
    // email service; `origin` resolves the link to this host). PHONE stays informational until the SMS rail is
    // live. Enumeration-neutral: the confirmation is identical regardless of whether the contact exists.
    async function submit() : Promise<void>
    {
        if( !valid ) return;
        if( method === ContactMethod.EMAIL )
        {
            const reply : RestfulService.Reply<PostPasswordForgot.Response> = await appmodel.server.fetch(
                new PostPasswordForgot( { account: email, origin: window.location.origin } ) );
            void reply;   // neutral — always show the same confirmation
        }
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
                                                        onChange={ ( _e : React.MouseEvent, value : ContactMethod | null ) => { if( value ) setMethod( value ); } }>
                                            <ToggleButton value={ ContactMethod.EMAIL }>Email</ToggleButton>
                                            <ToggleButton value={ ContactMethod.PHONE }>Phone</ToggleButton>
                                        </ToggleButtonGroup>

                                        <Show show={ method === ContactMethod.EMAIL }>
                                            <EmailInput id="forgot-password-email" label="Email" value={ email } autoComplete="email" onChange={ setEmail } />
                                        </Show>
                                        <Show show={ method === ContactMethod.PHONE }>
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
    export interface Props
    {
    }
}

export default ForgotPassword;

// eof
