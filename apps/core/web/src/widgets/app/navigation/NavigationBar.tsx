//
import React from 'react';
import { JSX } from "react";

import { Box, Collapse, List, ListItemButton, ListItemIcon, ListItemText, Stack, Typography } from '@mui/material';
import ExpandMoreIcon    from '@mui/icons-material/ExpandMore';
import ExpandLessIcon    from '@mui/icons-material/ExpandLess';
import ChevronLeftIcon   from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon  from '@mui/icons-material/ChevronRight';

import { Access }      from '@repo/system';
import AppModel        from '@model/AppModel';
import PubSubService   from '@model/service/PubSubService';
import ButtonIcon      from '@widgets/core/ButtonIcon';
import Subscriber      from '@widgets/core/Subscriber';
import navModel        from './navModel';
import AccountSwitcher from './AccountSwitcher';

//
// NavigationBar — the left nav. Three fixed zones so the footer never scrolls away: a pinned HEADER
// (account switcher + collapse toggle), a SCROLLABLE middle (the sections), and a pinned FOOTER (Profile +
// Account + Settings). Footer groups expand DOWNWARD like the main nav. Selection + which parent is expanded
// are inferred from the URL; contents are role-filtered (an item/child hidden if the role is below minRole).
// COLLAPSED → an icon rail: top-level leaves navigate, parents-with-children expand the bar to select, and
// the account icon opens the switch dropdown. Collapse state persists.
//
export function NavigationBar( props : NavigationBar.Props ) : JSX.Element
{
    const appmodel : AppModel = AppModel.instance();

    const [,bump]                      = React.useState< number >( 0 );
    const [userToggled,setUserToggled] = React.useState< Set<string> >( new Set() );
    const [collapsed,setCollapsedState] = React.useState< boolean >( appmodel.localStorage.get( "nav.collapsed" ) === "1" );

    const path       : string = window.location.pathname;
    const selectedId : string = navModel.selectedFor( path );
    const ancestorId : string = navModel.ancestorFor( path );

    const role     : Access.Role = appmodel.auth.role();
    const sections : Array<navModel.Section> = navModel.sectionsFor( role );
    const profile  : navModel.Item | null = navModel.itemFor( navModel.PROFILE, role );
    const account  : navModel.Item | null = navModel.itemFor( navModel.ACCOUNT, role );
    const help     : navModel.Item | null = navModel.itemFor( navModel.HELP, role );
    const chat     : navModel.Item | null = navModel.itemFor( navModel.CHAT, role );
    const settings : navModel.Item | null = navModel.itemFor( navModel.SETTINGS, role );

    function isOpen( id : string ) : boolean { return userToggled.has( id ) || id === ancestorId; }

    ////////////////////////////////////////////////////////////////////////////////////////////
    function setCollapsed( value : boolean ) : void
    {
        setCollapsedState( value );
        appmodel.localStorage.set( "nav.collapsed", value ? "1" : "0" );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    function toggleExpand( id : string ) : void
    {
        setUserToggled( ( prev : Set<string> ) =>
        {
            const next : Set<string> = new Set( prev );
            ( isOpen( id ) ? next.delete( id ) : next.add( id ) );
            return next;
        } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    function navigate( item : navModel.Item ) : void
    {
        // the Chat leaf has no route — it toggles the persistent right-side chat panel instead of navigating
        if( item.id === navModel.CHAT.id ) { appmodel.pubsub.publish( PubSubService.Type.CHAT, "toggle" ); return; }
        if( item.route ) appmodel.goto( item.route );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // collapsed-rail click on a parent: expand the bar to full width + open that parent so a child can be picked
    function expandAndOpen( id : string ) : void
    {
        setCollapsed( false );
        setUserToggled( ( prev : Set<string> ) => new Set( prev ).add( id ) );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    function Badge( count : number ) : JSX.Element
    {
        return <Box sx={{ bgcolor: "primary.main", color: "primary.contrastText", borderRadius: 5,
                          px: 0.75, minWidth: 20, height: 18, lineHeight: "18px", fontSize: 11, textAlign: "center" }}>
                    { count }
               </Box>;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    function Child( child : navModel.Item ) : JSX.Element
    {
        return  <ListItemButton key={ child.id } selected={ selectedId === child.id } onClick={ () => navigate( child ) }
                                sx={{ borderRadius: 1, py: 0.5, pl: 2 }}>
                    <ListItemText primary={ child.label } sx={{ "& .MuiListItemText-primary": { fontSize: 14 } }} />
                    { child.badge !== undefined ? Badge( child.badge ) : null }
                </ListItemButton>;
    }

    function Children( item : navModel.Item ) : JSX.Element
    {
        return  <Collapse in={ isOpen( item.id ) } timeout="auto" unmountOnExit>
                    <Box sx={{ ml: 2.25, pl: 1, borderLeft: "2px solid", borderColor: "divider" }}>
                        { ( item.children ?? [] ).map( ( child : navModel.Item ) => Child( child ) ) }
                    </Box>
                </Collapse>;
    }

    function Parent( item : navModel.Item ) : JSX.Element
    {
        const hasChildren : boolean = ( item.children?.length ?? 0 ) > 0;
        const open : boolean = isOpen( item.id );
        // chevron follows downward-accordion semantics: collapsed points down, expanded points up
        const chevron : JSX.Element = open ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />;

        return  <ListItemButton selected={ !hasChildren && selectedId === item.id }
                                onClick={ () => hasChildren ? toggleExpand( item.id ) : navigate( item ) }
                                sx={{ borderRadius: 1, py: 0.75 }}>
                    <ListItemIcon sx={{ minWidth: 36 }}>{ item.icon }</ListItemIcon>
                    <ListItemText primary={ item.label } />
                    { item.badge !== undefined ? Badge( item.badge ) : null }
                    { hasChildren ? <Box sx={{ display: "flex", ml: 0.5 }}>{ chevron }</Box> : null }
                </ListItemButton>;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // collapsed rail: an icon per top-level item (tooltip = label). Leaf → navigate; parent → expand the bar.
    function RailIcon( item : navModel.Item ) : JSX.Element
    {
        const hasChildren : boolean = ( item.children?.length ?? 0 ) > 0;
        const active : boolean = hasChildren ? ancestorId === item.id : selectedId === item.id;
        return  <ButtonIcon key={ item.id } id={ `nav-rail-${ item.id }` } label={ item.label }
                            icon={ item.icon ?? <></> }
                            onClick={ () => hasChildren ? expandAndOpen( item.id ) : navigate( item ) }
                            sx={{ borderRadius: 1, color: active ? "primary.main" : "text.secondary",
                                  bgcolor: active ? "action.selected" : "transparent" }} />;
    }

    // ===============================================================================================
    const width : number = collapsed ? 64 : 240;

    return  <Stack direction="column" sx={{ width, flexShrink: 0, height: "100%", minHeight: 0, overflow: "hidden" }}>

                {/* re-render on route + account/role changes */}
                <Subscriber event={ PubSubService.Type.ROUTE }   onChange={ () => bump( ( n : number ) => n + 1 ) } />
                <Subscriber event={ PubSubService.Type.PATH }    onChange={ () => bump( ( n : number ) => n + 1 ) } />
                <Subscriber event={ PubSubService.Type.ACCOUNT } onChange={ () => bump( ( n : number ) => n + 1 ) } />

                {/* HEADER (pinned): account + collapse toggle */}
                { collapsed
                    ? <Stack direction="column" spacing={ 0.5 } sx={{ alignItems: "center", flexShrink: 0, py: 0.75 }}>
                          <ButtonIcon id="nav-expand" label="Expand menu" size="small" icon={ <ChevronRightIcon /> } onClick={ () => setCollapsed( false ) } />
                          <AccountSwitcher compact />
                      </Stack>
                    : <Box sx={{ flexShrink: 0, display: "flex", alignItems: "center", gap: 0.5, px: 1, py: 0.75 }}>
                          <Box sx={{ flexGrow: 1, minWidth: 0 }}><AccountSwitcher /></Box>
                          <ButtonIcon id="nav-collapse" label="Collapse menu" size="small" icon={ <ChevronLeftIcon /> } onClick={ () => setCollapsed( true ) } />
                      </Box> }

                {/* MIDDLE (scrolls): sections / rail icons */}
                <Box sx={{ flexGrow: 1, minHeight: 0, overflowY: "auto", overflowX: "hidden", px: collapsed ? 0.5 : 1 }}>
                    { collapsed
                        ? <Stack direction="column" spacing={ 0.25 } sx={{ alignItems: "center" }}>
                              { sections.flatMap( ( s : navModel.Section ) => s.items ).map( ( item : navModel.Item ) => RailIcon( item ) ) }
                          </Stack>
                        : sections.map( ( section : navModel.Section ) => (
                              <Box key={ section.id } sx={{ mb: 1 }}>
                                  { section.title ? <Typography variant="overline" sx={{ px: 1.5, color: "text.secondary" }}>{ section.title }</Typography> : null }
                                  <List dense disablePadding>
                                      { section.items.map( ( item : navModel.Item ) => (
                                          <Box key={ item.id }>
                                              { Parent( item ) }
                                              { ( item.children?.length ?? 0 ) > 0 ? Children( item ) : null }
                                          </Box>
                                      ) ) }
                                  </List>
                              </Box>
                          ) ) }
                </Box>

                {/* FOOTER (pinned): Profile + Settings */}
                <Box sx={{ flexShrink: 0, borderTop: "1px solid", borderColor: "divider", px: collapsed ? 0.5 : 1, py: 0.5 }}>
                    { collapsed
                        ? <Stack direction="column" spacing={ 0.25 } sx={{ alignItems: "center" }}>
                              { profile  ? RailIcon( profile )  : null }
                              { account  ? RailIcon( account )  : null }
                              { help     ? RailIcon( help )     : null }
                              { chat     ? RailIcon( chat )     : null }
                              { settings ? RailIcon( settings ) : null }
                          </Stack>
                        : <List dense disablePadding>
                              { profile  ? Parent( profile )    : null }
                              { profile  ? Children( profile )  : null }
                              { account  ? Parent( account )    : null }
                              { account  ? Children( account )  : null }
                              { help     ? Parent( help )       : null }
                              { chat     ? Parent( chat )       : null }
                              { settings ? Parent( settings )   : null }
                              { settings ? Children( settings ) : null }
                          </List> }
                </Box>

            </Stack>;
}

export namespace NavigationBar
{
    export interface Props
    {
    }
}



export default NavigationBar;
