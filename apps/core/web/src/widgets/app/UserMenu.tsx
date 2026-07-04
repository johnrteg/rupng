//
import React from 'react';
import { JSX } from "react";

import { Box, Button, Menu, MenuItem, ListItemIcon, ListItemText, Typography } from '@mui/material';
import PersonOutlineOutlinedIcon       from '@mui/icons-material/PersonOutlineOutlined';
import ArrowDropDownIcon               from '@mui/icons-material/ArrowDropDown';
import LogoutOutlinedIcon              from '@mui/icons-material/LogoutOutlined';

import { Access }      from '@repo/system';
import AppModel        from '@model/AppModel';
import AppRouter       from '@main/AppRouter';
import PubSubService   from '@model/service/PubSubService';
import AlertPrompt     from '@widgets/core/AlertPrompt';
import Subscriber      from '@widgets/core/Subscriber';

//
// Human label for an account/app role (for the user menu's role line).
//
function roleLabel( role : Access.Role ) : string
{
    switch( role )
    {
        case Access.AccountRole.ACCOUNT: return "Account Admin";
        case Access.AccountRole.BILLING: return "Billing";
        case Access.AccountRole.USER:    return "User";
        case Access.AccountRole.SENDER:  return "Sender";
        case Access.AccountRole.MINIMUM: return "Limited";
        case Access.AppRole.ROOT:        return "Root";
        case Access.AppRole.APPLICATION: return "App Admin";
        case Access.AppRole.SUPPORT:     return "Support";
        default:                         return String( role );
    }
}

//
// UserMenu — the signed-in user affordance for the top bar: a person icon + name button that opens a
// dropdown with "Profile…" and "Logout". Logout asks for confirmation, then clears the session and returns
// to the sign-in page.
//
export function UserMenu( props : UserMenu.Props ) : JSX.Element
{
    const appmodel : AppModel = AppModel.instance();

    const [anchor,setAnchor]                = React.useState< HTMLElement | null >( null );
    const [confirmLogout,setConfirmLogout]  = React.useState< boolean >( false );
    const [,bumpRefresh]                    = React.useState< number >( 0 );   // re-render when the profile loads

    ////////////////////////////////////////////////////////////////////////////////////////////
    function openMenu( evt : React.MouseEvent<HTMLElement> ) : void { setAnchor( evt.currentTarget ); }
    function closeMenu() : void { setAnchor( null ); }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // Logout is destructive-ish → confirm first, then clear the session + return to sign-in.
    function onLogoutClick() : void
    {
        closeMenu();
        setConfirmLogout( true );
    }

    async function onLogoutAction( action : AlertPrompt.Action ) : Promise<void>
    {
        setConfirmLogout( false );
        if( action === AlertPrompt.Action.YES )
        {
            appmodel.logout();
            appmodel.goto( AppRouter.Route.LOGIN );
        }
    }

    // ===============================================================================================
    return  <>
                {/* re-render when the profile loads (LOGIN) and when the acting account/role changes (ACCOUNT) */}
                <Subscriber event={ PubSubService.Type.LOGIN }   onChange={ () => bumpRefresh( ( n : number ) => n + 1 ) } />
                <Subscriber event={ PubSubService.Type.ACCOUNT } onChange={ () => bumpRefresh( ( n : number ) => n + 1 ) } />

                <Button color="inherit"
                        onClick={ openMenu }
                        startIcon={ <PersonOutlineOutlinedIcon /> }
                        endIcon={ <ArrowDropDownIcon /> }
                        sx={{ textTransform: "none" }}>
                    {/* two rows: the user's name, then their current role */}
                    <Box sx={{ display: "flex", flexDirection: "column", alignItems: "flex-start", lineHeight: 1.15 }}>
                        <Typography variant="body2" sx={{ fontWeight: 600 }}>{ appmodel.auth.displayName() }</Typography>
                        <Typography variant="caption" sx={{ color: "text.secondary" }}>{ roleLabel( appmodel.auth.role() ) }</Typography>
                    </Box>
                </Button>

                <Menu anchorEl={ anchor }
                      open={ Boolean( anchor ) }
                      onClose={ closeMenu }
                      anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
                      transformOrigin={{ vertical: "top", horizontal: "right" }}>
                    <MenuItem onClick={ onLogoutClick }>
                        <ListItemIcon><LogoutOutlinedIcon fontSize="small" /></ListItemIcon>
                        <ListItemText>Logout</ListItemText>
                    </MenuItem>
                </Menu>

                { confirmLogout &&
                    <AlertPrompt id="logout"
                                 type={ AlertPrompt.Type.QUESTION }
                                 title="Sign out?"
                                 message="Are you sure you want to log out?"
                                 cancelText="Cancel"
                                 yesText="Log Out"
                                 yesColor="primary"
                                 onAction={ onLogoutAction } /> }
            </>;
}

export namespace UserMenu
{
    export interface Props
    {
    }
}

export default UserMenu;
