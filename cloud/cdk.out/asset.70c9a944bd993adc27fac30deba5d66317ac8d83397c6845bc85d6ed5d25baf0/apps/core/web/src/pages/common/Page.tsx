//
import React from 'react';
import { JSX } from "react";

//
import Box from '@mui/material/Box';

//
import AppModel             from "@model/AppModel";
import AppRouter            from '@main/AppRouter';


import PageWaiting          from './PageWaiting';
import HelpDrawer           from './HelpDrawer';
import NotificationBar      from '@widgets/app/NotificationBar';
import { Access }           from '@repo/endpoint';



export function Page( props : Page.Props ) : JSX.Element
{
    const appmodel : AppModel = AppModel.instance();
    
    const [validated,setValidated]  = React.useState< boolean >( false );

    //
    React.useEffect( () => componentLoaded(), [] );

    ////////////////////////////////////////////////////////////////////////////////////////////
    // when this is loaded, it means all of its children have loaded already
    function componentLoaded() : void
    {

        if( props.minAccess !== undefined )
        {
            if( !appmodel.auth.validSession() )
            {
                appmodel.goto( AppRouter.Route.LOGIN );
            }
            else
            {
            /*
                // check permission
                //console.log( 'check perm', props.permissions, appdata.login );
                let ok        : boolean = appmodel.auth.hasLoginRoleSet( props.roles, "any" );
                let status_ok : boolean = ( appmodel.acct.account && props.status.includes( appmodel.acct.account.status ) ) || props.status.length === 0 || ( appdata.acct.account === null && appdata.auth.isTexter() );

                if( ok === false )
                {
                    console.warn( 'Page does not have the correct role for', window.location.pathname, props.roles, appdata.auth.login );
                    appdata.goto( AppRouter.Route.DASHBOARD );
                }
                else if( status_ok === false )
                {
                    console.warn( 'Page does allow account status', window.location.pathname, props.status, appdata.auth.isRegularAdmin(), appdata.acct.account?.status );
                    
                    if( appdata.auth.isSuperAdmin() )
                    {
                        setValidated( true );
                    }
                    // if no match on status, but is hidden and the user is super-admin, allow it to continue
                    else if( appdata.acct.account
                        && appdata.acct.account.status === GetAccount.AccountStatus.HIDDEN
                        && appdata.auth.isRegularAdmin() )
                    {
                        setValidated( true );
                    }
                    // if not above, and the account is disabled, deleted or hidden (and user is not super-admin), go to disabled page
                    else if( appdata.acct.account
                        && (   appdata.acct.account.status === GetAccount.AccountStatus.DISABLED
                            || appdata.acct.account.status === GetAccount.AccountStatus.DELETED
                            || appdata.acct.account.status === GetAccount.AccountStatus.HIDDEN ) )
                    {
                        appdata.goto( AppRouter.Route.DASHBOARD );
                    }
                    // else redirect htem to dashboard since the current page does not have the corrent account status to access
                    else
                    {
                        appdata.goto( AppRouter.Route.DASHBOARD );
                    }
                }
                
                else
                {
                    setValidated( true );
                }
                */

                setValidated( true );

                
                
            }
        }
        else
        {
            setValidated( true );
        }

    }



    // ==================================================================================================================================

    return (
        <Box sx={{  height: '100vh',
                    overflowY: props.verticalScroll !== undefined ? props.verticalScroll: 'auto',
                    flex: 1,
                    minHeight: 0,
                    maxWidth: "100%",
                    width: "100%",
                    boxSizing: "border-box" }}>
            { validated ?
                        <>
                            { props.noNotify === undefined || props.noNotify === false ? <NotificationBar /> : null }
                            { props.children }
                            <HelpDrawer/>
                        </>
                        :
                        <PageWaiting/>
                        }
        </Box>
        
    );
}

/**
 * Page component is the top level component for a page.  The page takes up the entire screen of the browser.
 *
 * @param props.authorized - Flag to test if the user needs to be authorized (logged in) to display the page.  If true and the user is not logged in, they will be re-directed to the login page.
 * @param props.permissions - If authorized and logged in, the login will requires an array of roles that are needed to see the contents of the page.
 * @param props.status - If authorizeed and logged in, the current account the user is in will need to have a certain set of status to contine to see the contents of the page.
 * @param props.children - Contents of the page.
 * @param props.verticalScroll - Optionally determine how the vertical scroll bars might be shown.
 * @param props.noNotify - Optioanly state if the page includes the notification bar or not.
 */
export namespace Page
{
    export interface Props
    {
        //authorized      : boolean;
        //roles           : Array<AccountLogin.RoleType>;
        //status          : Array<GetAccount.AccountStatus>;
        minAccess?      : Access.Role;
        children?       : React.ReactNode | Array<React.ReactNode>;
        verticalScroll? : 'auto' | 'hidden';

        noNotify?       : boolean;
    }
}

export default Page;
// eof