import AppModel from "@model/AppModel";
//
import React from 'react';
import { JSX } from "react";

import { Box, Card, CardContent, CardHeader, Divider, Stack, ToggleButton, ToggleButtonGroup, Typography } from "@mui/material";
import LightModeOutlinedIcon from '@mui/icons-material/LightModeOutlined';
import DarkModeOutlinedIcon  from '@mui/icons-material/DarkModeOutlined';

import { Access }   from '@repo/system';

import { ThemeMode }   from '@model/service/UiService';
import AuthPage        from '@widgets/app/AuthPage';
import SelectInput     from '@widgets/core/SelectInput';

//
// Profile : Display — per-browser presentation preferences (they are NOT part of the account profile):
//   • Appearance — light / dark theme. Applied live via UiService.setTheme and persisted to the browser
//                  (the theme cookie the app reads on load).
//   • Language   — the UI language, chosen from the languages the app shipped (UiService.locale.languages).
//                  Applied live via UiService.setLanguage (loads the label file + persists the cookie).
// Both take effect immediately, so there is no Save button — the choice IS the action.
//
export function ProfileDisplay( props : ProfileDisplay.Props ) : JSX.Element
{
    const appmodel : AppModel = AppModel.instance();

    const [theme,setThemeMode] = React.useState< ThemeMode >( appmodel.ui.themeMode );
    const [language,setLanguage] = React.useState< string >( appmodel.ui.locale.language );

    ////////////////////////////////////////////////////////////////////////////////////////////
    // light/dark — apply immediately (UiService publishes THEME → the app re-themes + stores the cookie)
    function onThemeChange( mode : ThemeMode | null ) : void
    {
        if( mode === null ) return;   // ToggleButtonGroup emits null when the active button is re-clicked
        setThemeMode( mode );
        appmodel.ui.setTheme( mode );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // language — load the chosen label file + persist (UiService publishes LANGUAGE → labels refresh)
    function onLanguageChange( value : string ) : void
    {
        setLanguage( value );
        void appmodel.ui.setLanguage( value );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // the shipped languages as select choices, labelled with each language's endonym (fallback: the code)
    function languageChoices() : Array<SelectInput.Choice>
    {
        return appmodel.ui.locale.languages.map( ( code : string ) => ( { value: code, label: languageName( code ) } ) );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // a human-readable name for a BCP-47 code (e.g. "en-US" → "American English"), best-effort
    function languageName( code : string ) : string
    {
        try { return new Intl.DisplayNames( [ code ], { type: "language" } ).of( code ) ?? code; }
        catch { return code; }
    }

    return  <AuthPage minAccess={ Access.AccountRole.USER } title={"Profile : Display"}>
                <Box sx={{ p: 2, maxWidth: 880, mx: "auto" }}>

                    <Stack spacing={ 2 }>

                        {/* ── Appearance ───────────────────────────────────────────────────────── */}
                        <Card variant="outlined">
                            <CardHeader title={"Appearance"} subheader={"Choose a light or dark theme. Saved to this browser."} />
                            <Divider />
                            <CardContent>
                                <ToggleButtonGroup exclusive value={ theme } onChange={ ( _event, mode : ThemeMode | null ) => onThemeChange( mode ) }>
                                    <ToggleButton value={ ThemeMode.LIGHT } sx={{ px: 2 }}>
                                        <LightModeOutlinedIcon sx={{ mr: 1 }} />{"Light"}
                                    </ToggleButton>
                                    <ToggleButton value={ ThemeMode.DARK } sx={{ px: 2 }}>
                                        <DarkModeOutlinedIcon sx={{ mr: 1 }} />{"Dark"}
                                    </ToggleButton>
                                </ToggleButtonGroup>
                            </CardContent>
                        </Card>

                        {/* ── Language ─────────────────────────────────────────────────────────── */}
                        <Card variant="outlined">
                            <CardHeader title={"Language"} subheader={"The language used for labels throughout the app."} />
                            <Divider />
                            <CardContent>
                                <SelectInput id="display-language" label={"Language"} value={ language } choices={ languageChoices() } onChange={ onLanguageChange } sx={{ width: 280 }} />
                            </CardContent>
                        </Card>

                        <Typography variant="caption" sx={{ color: "text.secondary" }}>{"Display preferences are stored in this browser and apply right away."}</Typography>

                    </Stack>
                </Box>
            </AuthPage>;
}

export namespace ProfileDisplay
{
    export interface Props
    {
    }
}

export default ProfileDisplay;
// eof
