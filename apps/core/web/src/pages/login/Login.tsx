//
import React from 'react';
import { JSX } from "react";

//
import { Box, Paper, Stack, Button, Divider, ToggleButton, ToggleButtonGroup } from '@mui/material';

// SSO provider icons
import GoogleIcon           from '@mui/icons-material/Google';
import MicrosoftIcon        from '@mui/icons-material/Microsoft';
import AppleIcon            from '@mui/icons-material/Apple';
import BusinessIcon         from '@mui/icons-material/Business';   // enterprise / org SSO

// footer (support / legal) icons
import SupportAgentOutlinedIcon from '@mui/icons-material/SupportAgentOutlined';
import PrivacyTipOutlinedIcon   from '@mui/icons-material/PrivacyTipOutlined';
import GavelOutlinedIcon        from '@mui/icons-material/GavelOutlined';

//
import AppModel             from "@model/AppModel";
import AppRouter            from "@main/AppRouter";
import { ThemeMode }        from "@model/service/UiService";
import PubSubService        from "@model/service/PubSubService";

//
import Page                 from "@pages/common/Page";

//
import Subscriber           from "@widgets/core/Subscriber";
import EmailInput           from "@widgets/core/EmailInput";
import TelephoneInput       from "@widgets/core/TelephoneInput";
import PasswordInput        from "@widgets/core/PasswordInput";
import SelectInput          from "@widgets/core/SelectInput";
import ImageInput           from "@widgets/core/ImageInput";
import TextLabel            from "@widgets/core/TextLabel";
import LinkButton           from "@widgets/core/LinkButton";
import ButtonIcon           from "@widgets/core/ButtonIcon";
import Show                 from "@widgets/core/Show";

//
import ArrowBackIcon        from '@mui/icons-material/ArrowBack';

//
import { EmailUtils } from "@repo/common";

//
import KeyOutlinedIcon      from '@mui/icons-material/KeyOutlined';
import { startAuthentication, type PublicKeyCredentialRequestOptionsJSON } from "@simplewebauthn/browser";
import { PostLogin, PostLoginChallenge, PostLoginPasskeyOptions, PostLoginPasskeyVerify, Login as LoginApi, ContactMethod } from "@repo/api";
import { RestfulService } from "@repo/endpoint";
import TextInput           from "@widgets/core/TextInput";

//
import BrowserUtils         from "@utils/BrowserUtils";
import AppDef               from '@model/AppDef';
import ErrorMessage         from '@widgets/core/ErrorMessage';



export function Login( props : Login.Props ) : JSX.Element
{
    const appmodel : AppModel = AppModel.instance();

    // identifier method + credentials, advanced one step at a time (identifier → password → challenge)
    const [step,setStep]            = React.useState< Login.Step >( Login.Step.IDENTIFIER );
    const [method,setMethod]        = React.useState< ContactMethod >( ContactMethod.EMAIL );
    const [email,setEmail]          = React.useState< string >( "" );
    const [phone,setPhone]          = React.useState< string >( "" );
    const [password,setPassword]    = React.useState< string >( "" );
    const [error,setError]          = React.useState< string >( "" );

    // MFA (authenticator app) step — set when sign-in returns a TOTP challenge
    const [challengeToken,setChallengeToken] = React.useState< string >( "" );
    const [mfaCode,setMfaCode]               = React.useState< string >( "" );

    // passkey ceremony in flight — guards against a second click aborting the first (AbortError)
    const [passkeyBusy,setPasskeyBusy]       = React.useState< boolean >( false );

    const [languageChoices,setLanugaeChoices]          = React.useState< Array<SelectInput.Choice> >( [] );

    // ui preferences
    const [theme,setTheme]          = React.useState< ThemeMode >( appmodel.ui.themeMode );
    const [language,setLanguage]    = React.useState< string >( appmodel.ui.locale.language );
    const [,setRefresh]             = React.useState< number >( 0 );   // re-render labels on language change

    //
    React.useEffect( () => componentLoaded(), [] );
    React.useEffect( prefillAccount, [ props.account ] );

    ////////////////////////////////////////////////////////////////////////////////////////////
    // when this is loaded, it means all of its children have loaded already
    function componentLoaded() : void
    {
        let new_langs : Array<SelectInput.Choice> = [];
        appmodel.ui.locale.languages.forEach( ( lang : string ) => { new_langs.push( { value : lang, label : appmodel.label( 'language.' + lang ) } ) } );
        setLanugaeChoices( new_langs );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // ?account=<identifier> (from registration): detect whether it's an email or a phone, select the
    // matching tab, and prefill the field. If it's neither (unverifiable), leave everything blank.
    function prefillAccount() : void
    {
        const account : string = ( props.account ?? "" ).trim();
        if( account === "" ) return;

        if( EmailUtils.isValid( account ) )
        {
            setMethod( ContactMethod.EMAIL );
            setEmail( account );
        }
        else if( appmodel.ui.locale.phoneValid( account ) )
        {
            setMethod( ContactMethod.PHONE );
            setPhone( account );
        }
        // else: not a recognizable email or phone → fill nothing
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    async function onLogin() : Promise<void>
    {
        setError( "" );
        const account : string = method === ContactMethod.EMAIL ? email : phone;
        try
        {
            const reply : RestfulService.Reply<PostLogin.Response> = await appmodel.server.fetch( new PostLogin( { account, password } ) );
            if( reply.ok && reply.data?.complete && reply.data.sessionToken )
            {
                appmodel.setSession( reply.data.sessionToken, reply.data.refreshToken );
                appmodel.goto( AppRouter.Route.DASHBOARD );
            }
            else if( reply.ok && reply.data?.challenge === LoginApi.ChallengeType.TOTP && reply.data.challengeToken )
            {
                // authenticator-app gate: password was correct — now ask for the 6-digit code
                setChallengeToken( reply.data.challengeToken );
                setMfaCode( "" );
                setStep( Login.Step.CHALLENGE );
            }
            else
            {
                setError( "Email or password is incorrect." );
            }
        }
        catch( err )
        {
            appmodel.log.warn( "login", err );
            setError( "Sign-in failed. Please try again." );
        }
    }

    // "Continue" is enabled only when the email / phone is actually VALID (not merely non-empty).
    // `identifierDisplay` is the human-readable form shown on the password step (phone is formatted).
    const identifierValid : boolean = method === ContactMethod.EMAIL ? EmailUtils.isValid( email ) : appmodel.ui.locale.phoneValid( phone );
    const passwordValid : boolean   = password.trim().length > 0;

    // TelephoneInput emits E.164 once valid; the locale pretty-prints it (country auto-detected).
    const identifierDisplay : string = method === ContactMethod.EMAIL ? email : appmodel.ui.locale.phone( phone );

    ////////////////////////////////////////////////////////////////////////////////////////////
    // step 1 "Continue" → reveal the password step (enabled once an email/phone is entered)
    function onContinueIdentifier() : void
    {
        if( !identifierValid ) return;
        setError( "" );
        setStep( Login.Step.PASSWORD );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // "Change" → back to step 1 to edit the email/phone (clears the password)
    function onChangeIdentifier() : void
    {
        setStep( Login.Step.IDENTIFIER );
        setPassword( "" );
        setError( "" );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // step 2 "Continue" → submit credentials. A future auth response may return a CHALLENGE (emailed/
    // texted code, MFA app, …) → advance to Login.Step.CHALLENGE and render it. None are defined yet,
    // so a successful password step simply logs the user in.
    async function onContinuePassword() : Promise<void>
    {
        if( !passwordValid ) return;
        setError( "" );
        await onLogin();
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // MFA step — answer the authenticator-app (TOTP) challenge with the 6-digit code → tokens
    const mfaValid : boolean = mfaCode.trim().length === 6;

    async function onContinueChallenge() : Promise<void>
    {
        if( !mfaValid ) return;
        setError( "" );
        try
        {
            const reply : RestfulService.Reply<PostLoginChallenge.Response> = await appmodel.server.fetch(
                new PostLoginChallenge( { challengeToken, type: LoginApi.ChallengeType.TOTP, value: mfaCode.trim() } ) );
            if( reply.ok && reply.data?.complete && reply.data.sessionToken )
            {
                appmodel.setSession( reply.data.sessionToken );
                appmodel.goto( AppRouter.Route.DASHBOARD );
            }
            else
            {
                setError( "That code didn't match. Check your authenticator app and try again." );
            }
        }
        catch( err )
        {
            appmodel.log.warn( "login.mfa", err );
            setError( "Sign-in failed. Please try again." );
        }
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // "Back" from the MFA step → return to the password step (drops the challenge)
    function onCancelChallenge() : void
    {
        setStep( Login.Step.PASSWORD );
        setChallengeToken( "" );
        setMfaCode( "" );
        setError( "" );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // real <form> submit (the active step's Continue / Enter key) — preventDefault keeps it SPA (no reload)
    function onSubmit( event : React.FormEvent<HTMLFormElement> ) : void
    {
        event.preventDefault();
        if( step === Login.Step.IDENTIFIER )      onContinueIdentifier();
        else if( step === Login.Step.PASSWORD )   void onContinuePassword();
        else if( step === Login.Step.CHALLENGE )  void onContinueChallenge();
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // create a new account
    function onRegister() : void
    {
        appmodel.goto( AppRouter.Route.REGISTER );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // reset the PASSWORD for a known identifier. (There's no "forgot login" flow — sign-in is by email
    // or phone, which users don't forget the way they would an opaque account name / username.)
    function onForgotPassword() : void
    {
        appmodel.goto( AppRouter.Route.FORGOT_PASSWORD );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // passkey (WebAuthn) sign-in — get assertion options from auth, run the browser ceremony, verify,
    // then route to the dashboard. Discoverable credential: the authenticator offers the right passkey.
    async function onPasskey() : Promise<void>
    {
        if( passkeyBusy ) return;   // re-entry guard: a second ceremony aborts the first (AbortError)
        setPasskeyBusy( true );
        setError( "" );
        try
        {
            const optionsReply : RestfulService.Reply<PostLoginPasskeyOptions.Response> = await appmodel.server.fetch( new PostLoginPasskeyOptions() );
            if( !optionsReply.ok || !optionsReply.data ) { setError( "Passkey sign-in is unavailable right now." ); return; }

            const assertion = await startAuthentication( { optionsJSON: optionsReply.data.options as unknown as PublicKeyCredentialRequestOptionsJSON } );

            const verifyReply : RestfulService.Reply<PostLoginPasskeyVerify.Response> = await appmodel.server.fetch(
                new PostLoginPasskeyVerify( { ceremonyId: optionsReply.data.ceremonyId, response: assertion as unknown as Record<string, unknown> } ) );

            if( verifyReply.ok && verifyReply.data?.complete )
            {
                if( verifyReply.data.sessionToken ) appmodel.setSession( verifyReply.data.sessionToken );
                appmodel.goto( AppRouter.Route.DASHBOARD );
            }
            else
            {
                setError( "Passkey sign-in failed." );
            }
        }
        catch( err )
        {
            appmodel.log.warn( "passkey", err );
            const name : string = ( err as { name? : string } )?.name ?? "";
            // AbortError = the ceremony was interrupted (a second attempt started before the first finished);
            // NotAllowedError = the user dismissed the prompt or it timed out; anything else = unavailable.
            setError( name === "AbortError"     ? "Passkey prompt was interrupted — please try again."
                    : name === "NotAllowedError" ? "Passkey sign-in was cancelled or timed out."
                    :                              "Passkey sign-in was cancelled or unavailable." );
        }
        finally
        {
            setPasskeyBusy( false );
        }
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // social/consumer SSO (Google / Microsoft / Apple)
    function onSso( provider : Login.SsoProvider ) : void
    {
        // TODO: kick off the OIDC/OAuth flow via auth + @repo/oauth (redirect to the provider,
        //       round-trip through auth's $connect/callback). See apps/core/auth/specs/LOGIN.md (SSO).
        appmodel.log.info( "sso", provider );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // enterprise SSO — resolve the org's IdP (SAML/OIDC) by email domain, then redirect
    function onEnterpriseSso() : void
    {
        // TODO: identifier-first — prompt for work email → resolve account/IdP → redirect to the org SSO.
        //       Ties to the "SSO-only account" config (auth: SsoConnection.ssoOnly).
        appmodel.log.info( "enterprise sso" );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    function onThemeChange( value : string ) : void
    {
        const mode : ThemeMode = value as ThemeMode;
        appmodel.ui.setTheme( mode );   // publishes THEME → app re-themes
        setTheme( mode );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    function onLanguageChange( value : string ) : void
    {
        appmodel.ui.setLanguage( value );   // async: loads file, publishes LANGUAGE
        setLanguage( value );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // re-render so locale.label(...) text picks up the newly-loaded language
    function onLanguageChanged() : void
    {
        setRefresh( ( r : number ) => r + 1 );
    }


    ////////////////////////////////////////////////////////////////////////////////////////////
    const themeChoices : Array<SelectInput.Choice> =
    [
        { value : ThemeMode.LIGHT, label : appmodel.label( "page.login.theme.light" ) },
        { value : ThemeMode.DARK,  label : appmodel.label( "page.login.theme.dark" ) },
    ];



    // ==================================================================================================================================
    return <Page noNotify={ true }>

        {/* re-render this page's labels when the language changes */}
        <Subscriber event={ PubSubService.Type.LANGUAGE } onChange={ onLanguageChanged } />

        <Box sx={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", p: 2 }}>
            <Paper elevation={ 3 } sx={{ p: 4, width: "100%", maxWidth: 420, borderRadius: 2 }}>
                <Stack direction="column" spacing={ 2 }>

                    {/* whitelabel banner (per host) — falls back to the default when a host has no custom banner */}
                    <ImageInput id="login-banner"
                                value={ appmodel.ui.getHeaderImageUrl() }
                                alt={ appmodel.label( "page.login.banner.alt" ) }
                                defaultSrc="/assets/banner/default.png"
                                maxWidth={ 240 }
                                maxHeight={ 80 }
                                sx={{ alignSelf: "center" }} />

                    <TextLabel variant="h5" align="center" value={ "Testing " + appmodel.label( "page.login.title" ) } />

                    

                    {/* credentials in a real <form> → fixes the "password not in a form" warning,
                        enables password-manager autofill/save, and makes Enter submit natively */}
                    <Box component="form" onSubmit={ onSubmit }>
                        <Stack direction="column" spacing={ 2 }>

                            {/* STEP 1 — identify with email OR phone; "Continue" enables once it's entered */}
                            <Show show={ step === Login.Step.IDENTIFIER }>
                                <ToggleButtonGroup exclusive
                                                   fullWidth
                                                   size="small"
                                                   value={ method }
                                                   onChange={ ( _e : React.MouseEvent, value : ContactMethod | null ) => { if( value ) setMethod( value ); } }>
                                    <ToggleButton value={ ContactMethod.EMAIL }>{ appmodel.label( "page.login.method.email" ) }</ToggleButton>
                                    <ToggleButton value={ ContactMethod.PHONE }>{ appmodel.label( "page.login.method.phone" ) }</ToggleButton>
                                </ToggleButtonGroup>

                                <Show show={ method === ContactMethod.EMAIL }>
                                    <EmailInput id="login-email"
                                                label={ appmodel.label( "page.login.method.email" ) }
                                                value={ email }
                                                focus
                                                autoComplete="username"
                                                onChange={ setEmail } />
                                </Show>
                                <Show show={ method === ContactMethod.PHONE }>
                                    <TelephoneInput id="login-phone"
                                                    label={ appmodel.label( "page.login.method.phone" ) }
                                                    value={ phone }
                                                    fullWidth
                                                    autoFocus
                                                    autoComplete="username"
                                                    onChange={ setPhone } />
                                </Show>

                                <Button type="submit" variant="contained" fullWidth disabled={ !identifierValid }>Continue</Button>
                            </Show>

                            {/* STEP 2 — password; Back is pinned left, the identifier is CENTERED on the row
                                (both vertically centered). Absolute Back keeps the label truly centered. */}
                            <Show show={ step === Login.Step.PASSWORD }>
                                <Box sx={{ position: "relative", display: "flex", alignItems: "center", justifyContent: "center", minHeight: 40 }}>
                                    <Button size="small" color="inherit" startIcon={ <ArrowBackIcon fontSize="small" /> } onClick={ onChangeIdentifier } sx={{ position: "absolute", left: 0 }}>Back</Button>
                                    <TextLabel value={ identifierDisplay } />
                                </Box>

                                {/* passwordless-ish: offer a passkey first (discoverable credential — the
                                    authenticator picks the right one; no server-side "has a passkey?" lookup,
                                    so it stays enumeration-neutral). Password remains the fallback below. */}
                                <Button fullWidth variant="outlined" startIcon={ <KeyOutlinedIcon /> } disabled={ passkeyBusy } onClick={ () => void onPasskey() }>
                                    Use a passkey
                                </Button>

                                <Divider>or enter your password</Divider>

                                <PasswordInput id="login-password"
                                               label={ appmodel.label( "page.login.password" ) }
                                               value={ password }
                                               focus
                                               autoComplete="current-password"
                                               onChange={ setPassword } />

                                <Button type="submit" variant="contained" fullWidth disabled={ !passwordValid }>Continue</Button>
                            </Show>

                            {/* STEP 3 — MFA (authenticator app): the password was correct; enter the 6-digit code */}
                            <Show show={ step === Login.Step.CHALLENGE }>
                                <Box sx={{ position: "relative", display: "flex", alignItems: "center", justifyContent: "center", minHeight: 40 }}>
                                    <Button size="small" color="inherit" startIcon={ <ArrowBackIcon fontSize="small" /> } onClick={ onCancelChallenge } sx={{ position: "absolute", left: 0 }}>Back</Button>
                                    <TextLabel value={ "Enter the code from your authenticator app" } />
                                </Box>

                                <TextInput id="login-mfa-code"
                                           label={ "6-digit code" }
                                           value={ mfaCode }
                                           focus
                                           autoComplete="one-time-code"
                                           maxLength={ 6 }
                                           onChange={ setMfaCode } />

                                <Button type="submit" variant="contained" fullWidth disabled={ !mfaValid }>Verify</Button>
                            </Show>

                        </Stack>
                    </Box>

                    {/* "Forgot Password" (password step only — there's no "forgot login" flow: sign-in is by
                        email/phone). Register moved below the SSO section. (width:auto overrides fullWidth.) */}
                    <Show show={ step === Login.Step.PASSWORD }>
                        <Stack direction="row" sx={{ justifyContent: "flex-end", alignItems: "center" }}>
                            <LinkButton label="Forgot Password" onClick={ onForgotPassword } sx={{ width: "auto" }} />
                        </Stack>
                    </Show>

                    {/* SSO — only on the identifier step (hidden once you're entering a password).
                        TODO: an SSO-only account shows only this (resolve via app-bootstrap / account config). */}
                    <Show show={ step === Login.Step.IDENTIFIER }>
                        <Button fullWidth variant="outlined" startIcon={ <KeyOutlinedIcon /> } disabled={ passkeyBusy } onClick={ () => void onPasskey() }>
                            Sign in with a passkey
                        </Button>

                        <Divider>{ appmodel.label( "page.login.sso.divider" ) }</Divider>

                        <Stack direction="column" spacing={ 1 }>
                            <Button fullWidth variant="outlined" startIcon={ <GoogleIcon /> }
                                    onClick={ () => onSso( Login.SsoProvider.GOOGLE ) }>
                                { appmodel.label( "page.login.sso.google" ) }
                            </Button>
                            <Button fullWidth variant="outlined" startIcon={ <MicrosoftIcon /> }
                                    onClick={ () => onSso( Login.SsoProvider.MICROSOFT ) }>
                                { appmodel.label( "page.login.sso.microsoft" ) }
                            </Button>
                            <Button fullWidth variant="outlined" startIcon={ <AppleIcon /> }
                                    onClick={ () => onSso( Login.SsoProvider.APPLE ) }>
                                { appmodel.label( "page.login.sso.apple" ) }
                            </Button>
                            <Button fullWidth variant="text" startIcon={ <BusinessIcon /> }
                                    onClick={ onEnterpriseSso }>
                                { appmodel.label( "page.login.sso.enterprise" ) }
                            </Button>
                        </Stack>
                    </Show>

                    {/* Register — below the SSO section, given prominence for new users */}
                    <Stack direction="row" spacing={ 0.75 } sx={{ justifyContent: "center", alignItems: "center" }}>
                        <TextLabel value="New here?" />
                        <Button variant="text" onClick={ onRegister } sx={{ fontWeight: 700, textTransform: "none" }}>Register Here</Button>
                    </Stack>

                    {/* theme + language */}
                    <Divider />

                    <Stack direction="row" spacing={ 2 }>
                        <SelectInput id="login-theme"
                                     label={ appmodel.label( "page.login.theme.title" ) }
                                     value={ theme }
                                     choices={ themeChoices }
                                     onChange={ onThemeChange }
                                     sx={{ flex: 1 }} />
                        <SelectInput id="login-language"
                                     label={ appmodel.label( "page.login.language" ) }
                                     value={ language }
                                     choices={ languageChoices }
                                     onChange={ onLanguageChange }
                                     sx={{ flex: 1 }} />
                    </Stack>

                    <ErrorMessage  value={ error } />

                    <Divider />

                    {/* support / legal — icons (label shows as a tooltip) instead of text, to de-clutter */}
                    <Stack direction="row" spacing={ 1 } sx={{ justifyContent: "center" }}>
                        <ButtonIcon id="support" label={ appmodel.label( "page.login.support" ) } icon={ <SupportAgentOutlinedIcon /> } onClick={ () => BrowserUtils.open( AppDef.SUPPORT_URL ) } />
                        <ButtonIcon id="privacy" label={ appmodel.label( "page.login.privacy" ) } icon={ <PrivacyTipOutlinedIcon /> }   onClick={ () => BrowserUtils.open( AppDef.PRIVACY_URL ) } />
                        <ButtonIcon id="terms"   label={ appmodel.label( "page.login.terms" ) }   icon={ <GavelOutlinedIcon /> }        onClick={ () => BrowserUtils.open( AppDef.TERMS_URL ) } />
                    </Stack>

                    

                </Stack>
            </Paper>
        </Box>
    </Page>;
}

export namespace Login
{
    // the login is entered one step at a time: identify yourself, then prove it, then any challenge
    export enum Step
    {
        IDENTIFIER = "identifier",   // choose email/phone + enter it → Continue
        PASSWORD   = "password",     // enter the password → Continue
        CHALLENGE  = "challenge",    // future: emailed/texted code, MFA app, etc. (not yet implemented)
    }

    // social / consumer SSO providers (enterprise SAML/OIDC via the org IdP is handled separately)
    export enum SsoProvider
    {
        GOOGLE    = "google",
        MICROSOFT = "microsoft",
        APPLE     = "apple",
    }

    export interface Props
    {
        // ?account=<email|phone> — prefilled by registration; auto-selects the tab + fills the field
        account? : string;
    }
}
// eof
