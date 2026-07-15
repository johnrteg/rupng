//
import React from 'react';
import { JSX } from "react";

import { Box, Button, IconButton, Menu, MenuItem, ListItemIcon, ListItemText, Tooltip } from '@mui/material';
import ApartmentOutlinedIcon from '@mui/icons-material/ApartmentOutlined';
import ArrowDropDownIcon     from '@mui/icons-material/ArrowDropDown';
import CheckIcon             from '@mui/icons-material/Check';

import { User }      from '@repo/api';
import AppModel      from '@model/AppModel';
import PubSubService from '@model/service/PubSubService';
import Subscriber    from '@widgets/core/Subscriber';

//
// AccountSwitcher — the button at the top of the nav showing the account the user is currently acting in.
// Clicking opens a dropdown of the OTHER accounts they can switch to (a user belongs to 1..N accounts).
// `compact` renders just an icon (for the collapsed nav rail) that opens the same dropdown.
//
export function AccountSwitcher( props : AccountSwitcher.Props ) : JSX.Element
{
    const appmodel : AppModel = AppModel.instance();

    const [,bump]            = React.useState< number >( 0 );
    const [anchor,setAnchor] = React.useState< HTMLElement | null >( null );

    const current : User.Membership | null = appmodel.account.current;
    const others  : Array<User.Membership> = appmodel.account.accounts.filter( ( m : User.Membership ) => m.accountId !== current?.accountId );

    function openMenu( evt : React.MouseEvent<HTMLElement> ) : void { setAnchor( evt.currentTarget ); }
    function closeMenu() : void { setAnchor( null ); }

    ////////////////////////////////////////////////////////////////////
    function choose( accountId : string ) : void
    {
        closeMenu();
        appmodel.account.switchTo( accountId );   // updates current + broadcasts ACCOUNT → UI re-renders
    }

    ////////////////////////////////////////////////////////////////////
    // a sub-account shows its parent path ("Parent / Child"); a top-level account shows just its name
    function label( m : User.Membership ) : string
    {
        return m.parentName ? `${ m.parentName } / ${ m.accountName }` : m.accountName;
    }

    // shared: re-render on account/profile load, + the switch dropdown
    const subscribers : JSX.Element = <>
        <Subscriber event={ PubSubService.Type.ACCOUNT } onChange={ () => bump( ( n : number ) => n + 1 ) } />
        <Subscriber event={ PubSubService.Type.LOGIN }   onChange={ () => bump( ( n : number ) => n + 1 ) } />
    </>;

    const menu : JSX.Element = (
        <Menu anchorEl={ anchor } open={ Boolean( anchor ) } onClose={ closeMenu } slotProps={{ paper: { sx: { minWidth: 220 } } }}>
            { current
                ? <MenuItem selected disabled>
                      <ListItemIcon><CheckIcon fontSize="small" /></ListItemIcon>
                      <ListItemText>{ label( current ) }</ListItemText>
                  </MenuItem>
                : null }
            { others.map( ( m : User.Membership ) => (
                <MenuItem key={ m.accountId } onClick={ () => choose( m.accountId ) }>
                    <ListItemIcon><ApartmentOutlinedIcon fontSize="small" /></ListItemIcon>
                    <ListItemText>{ label( m ) }</ListItemText>
                </MenuItem>
            ) ) }
        </Menu>
    );

    // ── compact (collapsed rail): an icon that opens the switch dropdown ──
    if( props.compact )
    {
        return  <>
                    { subscribers }
                    <Tooltip title={ current ? current.accountName : "No account" } placement="right">
                        <IconButton color="inherit" onClick={ openMenu }
                                    sx={{ border: "1px solid", borderColor: "divider", borderRadius: 1 }}>
                            <ApartmentOutlinedIcon />
                        </IconButton>
                    </Tooltip>
                    { menu }
                </>;
    }

    // ── full: the named account button ──
    return  <>
                { subscribers }
                <Button fullWidth
                        color="inherit"
                        variant="outlined"
                        onClick={ openMenu }
                        disabled={ others.length === 0 }
                        startIcon={ <ApartmentOutlinedIcon color="primary"/> }
                        endIcon={ others.length > 0 ? <ArrowDropDownIcon /> : null }
                        sx={{ textTransform: "none", justifyContent: "flex-start", px: 1.25, py: 1,
                              // match the Divider color (theme `divider`) instead of the default outlined border
                              borderColor: "divider",
                              "&:hover": { borderColor: "divider" },
                              "&.Mui-disabled": { borderColor: "divider" },
                              "& .MuiButton-endIcon": { ml: "auto" } }}>
                    <Box sx={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textAlign: "left", flexGrow: 1 }}>
                        { current ? current.accountName : "No account" }
                    </Box>
                </Button>
                { menu }
            </>;
}

export namespace AccountSwitcher
{
    export interface Props
    {
        compact? : boolean;   // icon-only (for the collapsed nav rail)
    }
}

export default AccountSwitcher;
