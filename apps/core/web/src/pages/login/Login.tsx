//
import React from 'react';
import { JSX } from "react";

//
import { Box, Paper, Stack, Button, Divider, ToggleButton, ToggleButtonGroup } from '@mui/material';

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
import Show                 from "@widgets/core/Show";

//
import BrowserUtils         from "@utils/BrowserUtils";
import AppDef from '../../model/AppDef';



export function Login( props : Login.Props ) : JSX.Element
{
    const appmodel : AppModel = AppModel.instance();

    // identifier method + credentials
    const [method,setMethod]        = React.useState< Login.Method >( Login.Method.EMAIL );
    const [email,setEmail]          = React.useState< string >( "" );
    const [phone,setPhone]          = React.useState< string >( "" );
    const [password,setPassword]    = React.useState< string >( "" );

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

    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    function onLogin() : void
    {
        const identifier : string = method === Login.Method.EMAIL ? email : phone;

        // TODO: wire to auth once the login endpoint exists — appmodel.auth.login( identifier, password )
        //       (email-or-phone + password per apps/core/auth/specs/LOGIN.md). On success → goto dashboard.
        console.log( "login", { method, identifier, password } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    function onForgotPassword() : void
    {
        // TODO: route to the forgot-password page once built (AppRouter.Route.FORGOT_PASSWORD).
        console.log( "forgot password", { method, email, phone } );
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
    // a label, localized (falls back to the key until the language file defines it)
    function label( path : string ) : string
    {
        return appmodel.ui.locale.label( path );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    const themeChoices : Array<SelectInput.Choice> =
    [
        { value : ThemeMode.LIGHT, label : label( "login.theme.light" ) },
        { value : ThemeMode.DARK,  label : label( "login.theme.dark" ) },
    ];

    const languageChoices : Array<SelectInput.Choice> = appmodel.ui.locale.languages.map( ( code : string ) =>
    {
        let name : string = code;
        try { name = new Intl.DisplayNames( [ code ], { type : "language" } ).of( code ) ?? code; } catch { /* keep code */ }
        return { value : code, label : name };
    } );

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
                                alt={ label( "login.banner.alt" ) }
                                defaultSrc="/assets/banner/default.png"
                                maxWidth={ 240 }
                                maxHeight={ 80 }
                                sx={{ alignSelf: "center" }} />

                    <TextLabel variant="h5" align="center" value={ label( "login.title" ) } />

                    {/* theme + language */}
                    <Stack direction="row" spacing={ 2 }>
                        <SelectInput id="login-theme"
                                     label={ label( "login.theme" ) }
                                     value={ theme }
                                     choices={ themeChoices }
                                     onChange={ onThemeChange }
                                     sx={{ flex: 1 }} />
                        <SelectInput id="login-language"
                                     label={ label( "login.language" ) }
                                     value={ language }
                                     choices={ languageChoices }
                                     onChange={ onLanguageChange }
                                     sx={{ flex: 1 }} />
                    </Stack>

                    {/* sign in with email OR phone */}
                    <ToggleButtonGroup exclusive
                                       fullWidth
                                       size="small"
                                       value={ method }
                                       onChange={ ( _e : React.MouseEvent, value : Login.Method | null ) => { if( value ) setMethod( value ); } }>
                        <ToggleButton value={ Login.Method.EMAIL }>{ label( "login.method.email" ) }</ToggleButton>
                        <ToggleButton value={ Login.Method.PHONE }>{ label( "login.method.phone" ) }</ToggleButton>
                    </ToggleButtonGroup>

                    <Show show={ method === Login.Method.EMAIL }>
                        <EmailInput id="login-email"
                                    label={ label( "login.email" ) }
                                    value={ email }
                                    onChange={ setEmail }
                                    onEnter={ onLogin } />
                    </Show>
                    <Show show={ method === Login.Method.PHONE }>
                        <TelephoneInput id="login-phone"
                                        label={ label( "login.phone" ) }
                                        value={ phone }
                                        fullWidth
                                        onChange={ setPhone } />
                    </Show>

                    <PasswordInput id="login-password"
                                   label={ label( "login.password" ) }
                                   value={ password }
                                   onChange={ setPassword }
                                   onEnter={ onLogin } />

                    <Button variant="contained" fullWidth onClick={ onLogin }>{ label( "login.signin" ) }</Button>

                    <Box sx={{ textAlign: "center" }}>
                        <LinkButton label={ label( "login.forgot" ) } onClick={ onForgotPassword } />
                    </Box>

                    <Divider />

                    {/* support / legal */}
                    <Stack direction="row" spacing={ 2 } sx={{ justifyContent: "center" }}>
                        <LinkButton label={ label( "login.support" ) } onClick={ () => BrowserUtils.open( AppDef.SUPPORT_URL ) } />
                        <LinkButton label={ label( "login.privacy" ) } onClick={ () => BrowserUtils.open( AppDef.PRIVACY_URL ) } />
                        <LinkButton label={ label( "login.terms" ) }   onClick={ () => BrowserUtils.open( AppDef.TERMS_URL ) } />
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

    export interface Props
    {
    }
}
// eof
