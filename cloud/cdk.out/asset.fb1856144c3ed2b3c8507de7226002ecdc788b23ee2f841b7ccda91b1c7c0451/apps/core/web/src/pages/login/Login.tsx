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
import BrowserUtils         from "@utils/BrowserUtils";
import AppDef               from '@model/AppDef';
import ErrorMessage         from '@widgets/core/ErrorMessage';



export function Login( props : Login.Props ) : JSX.Element
{
    const appmodel : AppModel = AppModel.instance();

    // identifier method + credentials
    const [method,setMethod]        = React.useState< Login.Method >( Login.Method.EMAIL );
    const [email,setEmail]          = React.useState< string >( "" );
    const [phone,setPhone]          = React.useState< string >( "" );
    const [password,setPassword]    = React.useState< string >( "" );
    const [error,setError]          = React.useState< string >( "" );

    const [languageChoices,setLanugaeChoices]          = React.useState< Array<SelectInput.Choice> >( [] );

    // ui preferences
    const [theme,setTheme]          = React.useState< ThemeMode >( appmodel.ui.themeMode );
    const [language,setLanguage]    = React.useState< string >( appmodel.ui.locale.language );
    const [,setRefresh]             = React.useState< number >( 0 );   // re-render labels on language change

    //
    React.useEffect( () => componentLoaded(), [] );

    ////////////////////////////////////////////////////////////////////////////////////////////
    // when this is loaded, it means all of its children have loaded already
    function componentLoaded() : void
    {
        let new_langs : Array<SelectInput.Choice> = [];
        appmodel.ui.locale.languages.forEach( ( lang : string ) => { new_langs.push( { value : lang, label : appmodel.label( 'language.' + lang ) } ) } );
        setLanugaeChoices( new_langs );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    async function onLogin() : Promise<void>
    {
        const identifier : string = method === Login.Method.EMAIL ? email : phone;

        // TODO: wire to auth once the login endpoint exists — appmodel.auth.login( identifier, password )
        //       (email-or-phone + password per apps/core/auth/specs/LOGIN.md). On success → goto dashboard.
        console.log( "login", { method, identifier, password } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // real <form> submit (Sign In button / Enter key) — preventDefault keeps it an SPA submit (no reload)
    function onSubmit( event : React.FormEvent<HTMLFormElement> ) : void
    {
        event.preventDefault();
        onLogin();
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    function onForgotPassword() : void
    {
        // TODO: route to the forgot-password page once built (AppRouter.Route.FORGOT_PASSWORD).
        console.log( "forgot password", { method, email, phone } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // social/consumer SSO (Google / Microsoft / Apple)
    function onSso( provider : Login.SsoProvider ) : void
    {
        // TODO: kick off the OIDC/OAuth flow via auth + @repo/oauth (redirect to the provider,
        //       round-trip through auth's $connect/callback). See apps/core/auth/specs/LOGIN.md (SSO).
        console.log( "sso", provider );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // enterprise SSO — resolve the org's IdP (SAML/OIDC) by email domain, then redirect
    function onEnterpriseSso() : void
    {
        // TODO: identifier-first — prompt for work email → resolve account/IdP → redirect to the org SSO.
        //       Ties to the "SSO-only account" config (auth: SsoConnection.ssoOnly).
        console.log( "enterprise sso" );
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

                    <TextLabel variant="h5" align="center" value={ "hiii " + appmodel.label( "page.login.title" ) } />

                    

                    {/* credentials in a real <form> → fixes the "password not in a form" warning,
                        enables password-manager autofill/save, and makes Enter submit natively */}
                    <Box component="form" onSubmit={ onSubmit }>
                        <Stack direction="column" spacing={ 2 }>

                            {/* sign in with email OR phone */}
                            <ToggleButtonGroup exclusive
                                               fullWidth
                                               size="small"
                                               value={ method }
                                               onChange={ ( _e : React.MouseEvent, value : Login.Method | null ) => { if( value ) setMethod( value ); } }>
                                <ToggleButton value={ Login.Method.EMAIL }>{ appmodel.label( "page.login.method.email" ) }</ToggleButton>
                                <ToggleButton value={ Login.Method.PHONE }>{ appmodel.label( "page.login.method.phone" ) }</ToggleButton>
                            </ToggleButtonGroup>

                            <Show show={ method === Login.Method.EMAIL }>
                                <EmailInput id="login-email"
                                            label={ appmodel.label( "page.login.method.email" ) }
                                            value={ email }
                                            autoComplete="username"
                                            onChange={ setEmail } />
                            </Show>
                            <Show show={ method === Login.Method.PHONE }>
                                <TelephoneInput id="login-phone"
                                                label={ appmodel.label( "page.login.method.phone" ) }
                                                value={ phone }
                                                fullWidth
                                                autoComplete="username"
                                                onChange={ setPhone } />
                            </Show>

                            <PasswordInput id="login-password"
                                           label={ appmodel.label( "page.login.password" ) }
                                           value={ password }
                                           autoComplete="current-password"
                                           onChange={ setPassword } />

                            <Button type="submit" variant="contained" fullWidth>{ appmodel.label( "page.login.signin" ) }</Button>

                        </Stack>
                    </Box>

                    {/* LinkButton is fullWidth with internal justifyContent:flex-start, so it fills the row
                        and left-pins its text — override to flex-end to right-justify (textAlign can't move it) */}
                    <LinkButton label={ appmodel.label( "page.login.forgot" ) } onClick={ onForgotPassword } sx={{ justifyContent: "flex-end" }} />

                    {/* SSO — TODO: an SSO-only account hides the password form above and shows only this
                        (resolve via the app-bootstrap / account config; auth: SsoConnection.ssoOnly) */}
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
    export enum Method
    {
        EMAIL = "email",
        PHONE = "phone",
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
    }
}
// eof
