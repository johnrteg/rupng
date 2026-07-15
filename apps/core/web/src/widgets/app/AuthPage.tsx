//
import React from 'react';
import { JSX } from "react";

import { Box, Divider, Stack, Typography } from '@mui/material';

//
import AppModel         from '@model/AppModel';
import { Access }       from '@repo/system';

import Page             from '../../pages/common/Page';
import NavigationBar    from './navigation/NavigationBar';
import ChatPanel        from './ChatPanel';
import ImageInput       from '../core/ImageInput';
import SearchInput      from '../core/SearchInput';
import UserMenu         from './UserMenu';
import NotificationButton from './NotificationButton';

export function AuthPage( props : AuthPage.Props ) : JSX.Element
{
    const appmodel : AppModel = AppModel.instance();

    const [search,setSearch] = React.useState< string >( "" );   // top-bar search (TODO: wire to a results action)

    React.useEffect( () => componentLoaded(), [] );

    ////////////////////////////////////////////////////////////////////////////////////////////
    function componentLoaded() : void
    {
    }

    return  <Page minAccess={ props.minAccess } noNotify>{ /* the authed shell has its own top bar (bell) — skip Page's NotificationBar so it doesn't add height above the 100%-tall shell (the ~20px overflow) */ }
                {/* full-height flex COLUMN: the top bar is auto-height, the nav+content row fills the REST.
                    (Previously the row was height:100% and sat below the bar, overflowing the viewport by the
                    bar's height — which pushed the bottom-pinned Profile/Settings off-screen behind a scrollbar.) */}
                <Box sx={{ height: "100%", minHeight: 0, display: "flex", flexDirection: "column" }}>

                    {/* top bar (auto height) — primary color; text/icons flip to the contrast color */}
                    <Box sx={{ flexShrink: 0, bgcolor: "primary.main", color: "primary.contrastText" }}>
                        <Stack direction="row" spacing={ 1 } sx={{ px: 1, py : 0.5, alignItems: "center" }}>
                            <ImageInput id="login-banner"
                                        value={ appmodel.ui.getHeaderImageUrl() }
                                        alt={ appmodel.label( "page.login.banner.alt" ) }
                                        defaultSrc="/assets/banner/default.png"
                                        maxWidth={ 180 }
                                        maxHeight={ 35 } />
                            <Divider orientation="vertical" flexItem />
                            <Typography variant="h5">{ props.title }</Typography>
                            {/* spacer pushes search + notifications + user menu to the far right of the top bar */}
                            <Box sx={{ flexGrow: 1 }} />
                            {/* transparent field on the primary bar — only the outline, label, text, and icons
                                take the contrast color (theme tokens; the bar shows through) */}
                            <Box sx={{
                                    "& .MuiInputLabel-root":                                   { color: "primary.contrastText" },
                                    "& .MuiInputLabel-root.Mui-focused":                       { color: "primary.contrastText" },
                                    "& .MuiOutlinedInput-input":                               { color: "primary.contrastText" },
                                    "& .MuiOutlinedInput-notchedOutline":                      { borderColor: "primary.contrastText" },
                                    "&:hover .MuiOutlinedInput-notchedOutline":                { borderColor: "primary.contrastText" },
                                    "& .MuiOutlinedInput-root.Mui-focused .MuiOutlinedInput-notchedOutline": { borderColor: "primary.contrastText" },
                                    "& .MuiSvgIcon-root":                                      { color: "primary.contrastText" },
                                 }}>
                                <SearchInput id="topbar-search" label="Search" value={ search } onChange={ setSearch } sx={{ width: 220 }} />
                            </Box>
                            <NotificationButton />
                            <UserMenu />
                        </Stack>
                        <Divider orientation="horizontal" flexItem />
                    </Box>

                    {/* nav + content — fills the remaining height; the vertical divider runs that full height */}
                    <Box sx={{ flexGrow: 1, minHeight: 0, display: "flex", flexDirection: "row" }}>
                        <NavigationBar />
                        <Divider orientation="vertical" flexItem />
                        <Box sx={{ flexGrow: 1, minWidth: 0, overflow: "auto" }}>
                            { props.children }
                        </Box>
                        {/* persistent right-side chat panel — toggled from the nav "Chat" leaf; renders nothing while closed */}
                        <ChatPanel />
                    </Box>

                </Box>
            </Page>;
}

export namespace AuthPage
{
    export interface Props
    {
        minAccess?      : Access.Role;
        title : string;
        children?       : React.ReactNode | Array<React.ReactNode>;
    }
}



export default AuthPage;