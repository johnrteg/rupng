//
import React, { Suspense } from 'react';
import { JSX } from "react";

//import ReactGA from "react-ga4";

/*
import Analytics                            from '@common/utils/Analytics';
import PubSub                               from '@common/data/PubSub';

import Subscriber                           from '../app/widgets/Subscriber';
import PageWaiting                          from '../app/pages/PageWaiting';

// Critical pages (loaded immediately)
import ErrorPage                            from "../app/pages/ErrorPage";
import Login                                from "../app/pages/login/Login";
import Dashboard                            from "../app/pages/dashboard/Dashboard";
*/

// Lazy-loaded pages (loaded on demand)
/*
const SignUp            : React.LazyExoticComponent<React.ComponentType<{}>> = React.lazy(() => import("@pages/register/SignUp"));
const Reports           : React.LazyExoticComponent<React.ComponentType<{}>> = React.lazy(() => import("@pages/reports/Reports"));
const ForgotPassword    : React.LazyExoticComponent<React.ComponentType<{}>> = React.lazy(() => import("@pages/login/ForgotPassword"));
const Conversations     : React.LazyExoticComponent<React.ComponentType<{}>> = React.lazy(() => import("@pages/conversations/Conversations"));
const Contacts          : React.LazyExoticComponent<React.ComponentType<{}>> = React.lazy(() => import("@pages/contacts/Contacts"));
const Tools             : React.LazyExoticComponent<React.ComponentType<{}>> = React.lazy(() => import("@pages/tools/Tools"));
const Projects          : React.LazyExoticComponent<React.ComponentType<{}>> = React.lazy(() => import("@pages/projects/Projects"));
const Profile           : React.LazyExoticComponent<React.ComponentType<{}>> = React.lazy(() => import("@pages/profile/Profile"));
const Admins            : React.LazyExoticComponent<React.ComponentType<{}>> = React.lazy(() => import("@pages/account/admins/AccountAdmins"));
const Billing           : React.LazyExoticComponent<React.ComponentType<{}>> = React.lazy(() => import("@pages/account/billing/Billing"));
const AccountInfo       : React.LazyExoticComponent<React.ComponentType<{}>> = React.lazy(() => import("@pages/account/info/AccountInfo"));
const Registry          : React.LazyExoticComponent<React.ComponentType<{}>> = React.lazy(() => import("@pages/registry/Registry"));
const Teams             : React.LazyExoticComponent<React.ComponentType<{}>> = React.lazy(() => import("@pages/teams/Teams"));
const Kitchen           : React.LazyExoticComponent<React.ComponentType<{}>> = React.lazy(() => import("@pages/kitchen/Kitchen"));
const Optin             : React.LazyExoticComponent<React.ComponentType<{id: string}>>  = React.lazy(() => import('@pages/optin/Optin'));
const OptinSample       : React.LazyExoticComponent<React.ComponentType<{id: string}>>  = React.lazy(() => import('@pages/optin/OptinSample'));
const Send              : React.LazyExoticComponent<React.ComponentType<{}>> = React.lazy(() => import('@pages/send/Send'));
const AccountStatus     : React.LazyExoticComponent<React.ComponentType<{}>> = React.lazy(() => import('@pages/dashboard/AccountStatus'));
const ResetPassword     : React.LazyExoticComponent<React.ComponentType<{token:string}>> = React.lazy(() => import('@pages/login/ResetPassword'));
const AccountCancelled     : React.LazyExoticComponent<React.ComponentType<{token:string}>> = React.lazy(() => import('@pages/account/info/AccountCancelled'));
*/



// others
import AppModel         from '@model/AppModel';
import PubSubService    from '@model/service/PubSubService';
import PageWaiting      from '@pages/common/PageWaiting';
import { Dashboard }    from '@pages/dashboard/Dashboard';
import { Login }        from '@pages/login/Login';
import Subscriber       from '@widgets/core/Subscriber';
import ErrorPage        from '@pages/common/ErrorPage';


interface RouteMatch
{
    match: boolean;
    params: Record<string, string>;
}

interface Route
{
    path : string;
    component : ( params?: any ) => JSX.Element;
}

// Helper function to wrap lazy components with error boundaries
function withLazyWrapper<T extends Record<string, any>>(
    LazyComponent: React.LazyExoticComponent<React.ComponentType<T>>
) {
    return (props: T) => (
        <Suspense fallback={<PageWaiting />}>
            <LazyComponent {...props} />
        </Suspense>
    );
}


export function AppRouter( props : AppRouter.Props ) : JSX.Element
{
    const appdata : AppModel         = AppModel.instance();

    const [route,setRoute]          = React.useState< string >( "" );
    const [routes,setRoutes]        = React.useState< Array<Route> >( [] );

    //
    React.useEffect( () => componentLoaded(), [] );
    React.useEffect( () => () => componentUnLoaded(), [] );
    React.useEffect( routeChanged, [route] );

    ////////////////////////////////////////////////////////////////////////////////////////////////////////////
    function componentLoaded() : void
    {
        window.addEventListener('popstate', urlChanged );
        appdata.pubsub.addSubscriber( PubSubService.Type.ROUTE, onRouteChanged );
        setRoute( fullPath() );
        updateRoutes();
    }

    ////////////////////////////////////////////////////////////////////////////////////////////////////////////
    function componentUnLoaded() : void
    {
        window.removeEventListener('popstate', urlChanged );
        appdata.pubsub.removeSubscriber( PubSubService.Type.ROUTE, onRouteChanged );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////////////////////
    function updateRoutes() : void
    {
        const new_routes : Array<Route> = [];
    
        // go from most common to lease common

        // dashboard (loaded immediately - most common)
        new_routes.push( { path: AppRouter.Route.DASHBOARD, component: () => <Dashboard /> } );

        // least common (mixed - some critical, some lazy)
        new_routes.push( { path: AppRouter.Route.ROOT     , component: () => <Dashboard /> } );
        //new_routes.push( { path: AppRouter.Route.REGISTER , component: withLazyWrapper(SignUp) } );
        //new_routes.push( { path: AppRouter.Route.FORGOT   , component: withLazyWrapper(ForgotPassword) } );
        new_routes.push( { path: AppRouter.Route.LOGIN    , component: ( params : Login.Props ) => <Login {...params} /> } );
        //new_routes.push( { path: AppRouter.Route.REGISTRY , component: withLazyWrapper(Registry) } );

/*
        // conversations (lazy loaded)
        new_routes.push( { path: AppRouter.Route.CONVERSATIONS + "/:cid", component: withLazyWrapper(Conversations) } );
        new_routes.push( { path: AppRouter.Route.CONVERSATIONS + "/:cid/:project", component: withLazyWrapper(Conversations) } );
        new_routes.push( { path: AppRouter.Route.CONVERSATIONS, component: withLazyWrapper(Conversations) } );

        // send (lazy loaded)
        new_routes.push( { path: AppRouter.Route.SEND + "/:cid", component: withLazyWrapper(Send) } );
        new_routes.push( { path: AppRouter.Route.SEND + "/:cid/:project", component: withLazyWrapper(Send) } );
        new_routes.push( { path: AppRouter.Route.SEND , component: withLazyWrapper(Send) } );

        // projects (lazy loaded)
        //if( appdata.auth.hasLoginRoleSet([ AccountLogin.RoleType.PROJECTS ], "any" ) )
        //{
            new_routes.push( { path: AppRouter.Route.ACTIONS + "/:cid", component: withLazyWrapper(Projects) } );
            new_routes.push( { path: AppRouter.Route.ACTIONS + "/:cid/:project", component: withLazyWrapper(Projects) } );
            new_routes.push( { path: AppRouter.Route.ACTIONS , component: withLazyWrapper(Projects) } );
            new_routes.push( { path: AppRouter.Route.PROJECTS , component: withLazyWrapper(Projects) } );
        //}

        // contacts (lazy loaded)
        //if( appdata.auth.hasLoginRoleSet([ AccountLogin.RoleType.CONTACTS ], "any" ) )
        //{
            new_routes.push( { path: AppRouter.Route.CONTACTS + "/:tab", component: withLazyWrapper(Contacts) } );
            new_routes.push( { path: AppRouter.Route.CONTACTS , component: withLazyWrapper(Contacts) } );
        //}

        // tools (lazy loaded)
        new_routes.push( { path: AppRouter.Route.TOOLS + "/:tool", component: withLazyWrapper(Tools) } );
        new_routes.push( { path: AppRouter.Route.TOOLS , component: withLazyWrapper(Tools) } );

        // reports (lazy loaded)
        //if( appdata.auth.hasLoginRoleSet([ AccountLogin.RoleType.REPORTS ], "any" ) )
        //{
            new_routes.push( { path: AppRouter.Route.REPORTS + "/:tab", component: withLazyWrapper(Reports) } );
            new_routes.push( { path: AppRouter.Route.REPORTS , component: withLazyWrapper(Reports) } );
        //}

        // profile (lazy loaded)
        //if( appdata.auth.hasLoginRoleSet([ AccountLogin.RoleType.ACCOUNT, AccountLogin.RoleType.TEXTER ], "any" ) )
        //{
            new_routes.push( { path: AppRouter.Route.PROFILE + "/:tab", component: withLazyWrapper(Profile) } );
            new_routes.push( { path: AppRouter.Route.PROFILE , component: withLazyWrapper(Profile) } );
        //}

        // admin (lazy loaded)
        //if( appdata.auth.hasLoginRoleSet([ AccountLogin.RoleType.ACCOUNT ], "any" ) )
        //{
            new_routes.push( { path: AppRouter.Route.ADMINS , component: withLazyWrapper(Admins) } );
        //}

        // billing (lazy loaded)
        //if( appdata.auth.hasLoginRoleSet([ AccountLogin.RoleType.BILLING ], "any" ) )
        //{
            new_routes.push( { path: AppRouter.Route.BILLING , component: withLazyWrapper(Billing) } );
        //}

        // account info (lazy loaded)
        //if( appdata.auth.hasLoginRoleSet([ AccountLogin.RoleType.ACCOUNT ], "any" ) )
        //{
            new_routes.push( { path: AppRouter.Route.INFORMATION + "/:section", component: withLazyWrapper(AccountInfo) } );
            new_routes.push( { path: AppRouter.Route.INFORMATION , component: withLazyWrapper(AccountInfo) } );
        //}

        // teams (lazy loaded)
        new_routes.push( { path: AppRouter.Route.TEAMS + "/:tab", component: withLazyWrapper(Teams) } );
        new_routes.push( { path: AppRouter.Route.TEAMS , component: withLazyWrapper(Teams) } );

        // optin (lazy loaded)
        new_routes.push( { path: AppRouter.Route.OPTIN + "/:id", component: withLazyWrapper(Optin) } );
        new_routes.push( { path: AppRouter.Route.OPTINSAMPLE + "/:id", component: withLazyWrapper(OptinSample) } );

        

        // optin (lazy loaded)
        new_routes.push( { path: AppRouter.Route.RESET_PWD, component: withLazyWrapper(ResetPassword) } );

        new_routes.push( { path: AppRouter.Route.DISABLED, component: () => <AccountStatus /> } );

        new_routes.push( { path: AppRouter.Route.CANCEL, component: withLazyWrapper(AccountCancelled) } );

        new_routes.push( { path: AppRouter.Route.KITCHEN , component: withLazyWrapper(Kitchen) } );
        */

        setRoutes( new_routes );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////////////////////
    function routeChanged() : void
    {
        if( appdata.cache.tracker )
        {
            //ReactGA.send({ hitType: Analytics.Type.PAGE, page: window.location.pathname });
        }
        appdata.pubsub.publish( PubSubService.Type.PATH, window.location.pathname );
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////////////
    function fullPath() : string
    {
        return ( window.location.pathname + window.location.search ).trim(); 
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////////////
    // from user selecting forward or back button
    function urlChanged( this: Window, evt: PopStateEvent ) : void
    {
        if( route !== fullPath() )setRoute( fullPath() );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////////////////////
    // from internal change to the url (AppData::goto)
    function onRouteChanged( event : PubSubService.Event ) : void
    {
        if( route !== fullPath() )setRoute( fullPath() );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////////////////////
    function parseQuery( queryString: string ) : Record<string, string>
    {
        const params: Record<string, string> = {};
        if( !queryString ) return params;
        const pairs : Array<string> = queryString.replace(/^\?/, '').split('&');
        for( const pair of pairs )
        {
            if( !pair ) continue;
            const [key, value] = pair.split('=');
            params[ decodeURIComponent( key ) ] = decodeURIComponent( value || '' );
        }
        return params;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////////////////////
    function matchRoute( signature: string, path: string ) : RouteMatch
    {
        const sigParts  : Array<string> = signature.split('/').filter(Boolean);
        const pathParts : Array<string> = path.split('/').filter(Boolean);

        if( sigParts.length !== pathParts.length ) return { match: false, params: {} };

        // parse off the paramters
        const params : Record<string, string> = {};
        for( let i = 0; i < sigParts.length; i++ )
        {
            if( sigParts[i].startsWith(':') )
            {
                params[sigParts[i].substring(1)] = pathParts[i];
            }
            else if( sigParts[i].toLowerCase() !== pathParts[i].toLowerCase() )
            {
                return { match: false, params: {} };
            }
        }
        return { match: true, params };
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////////////////
    function onLoginChanged( event : PubSubService.Event ) : void
    {
        //console.log('AppRouter::onLoginChanged');
        updateRoutes();
    }

    //console.log('AppRouter::route', route );
    let page : JSX.Element | null = null;

    let route_match : RouteMatch;
    if( route !== "" )
    {
        // split any queries that might have been added to the route
        const [pathnameRaw, queryString] = route.split('?');
        const pathname : string = ( pathnameRaw || "" ).trim();
        //console.log('route', route, pathname, queryString );

        // look at each registered route
        for( const routeItem of routes )
        {
            route_match = matchRoute( routeItem.path, pathname );
            //console.log( 'match', { route: route, pathOption: routeItem.path, pathRequest: pathname, match: route_match.match } );
            if( route_match.match )
            {
                // break up the parameters
                const queryParams : Record<string, string> = parseQuery( queryString || "" );
                //console.log('query', queryString, queryParams );

                // merge with resource items
                const allParams: any = { ...route_match.params, ...queryParams };

                // give to component
                page = routeItem.component( allParams );
                break;
            }
        }

        // nothing found, default
        //console.log('page', { route: route, invalid: page === null } );
        if( page === null )page = <ErrorPage redirect={ appdata.hasSessionCookie() ? AppRouter.Route.DASHBOARD :  AppRouter.Route.LOGIN } />;
    }
    
    return  <>
                <Subscriber event={ PubSubService.Type.LOGIN } onChange={ onLoginChanged } />
                { page }
            </>;
}

export namespace AppRouter
{
    export enum Route
    {
        // server api's to avoid:
        // /login
        // /auth
        // /account
        // /verify
        // /passkey
        ROOT            = `/`,
        LOGIN           = `/signin`,
        DASHBOARD       = `/dashboard`,

        /*
        DASHBOARD       = `/${prefix}/dashboard`,

        SEND            = `/${prefix}/text`,

        REGISTER        = `/${prefix}/register`,
        
        FORGOT          = `/${prefix}/forgot`,
        CONVERSATIONS   = `/${prefix}/chats`,

        ACTIONS         = `/${prefix}/action`,         // backward compatible (remove at some point)
        PROJECTS        = `/${prefix}/projects`,

        CONTACTS        = `/${prefix}/contacts`,
        TOOLS           = `/${prefix}/tools`,

        REPORTS         = `/${prefix}/reports`,

        PROFILE         = `/${prefix}/profile`,
        INFORMATION     = `/${prefix}/information`,
        BILLING         = `/${prefix}/billing`,
        ADMINS          = `/${prefix}/admins`,
        TEAMS           = `/${prefix}/teams`,
        REGISTRY        = `/${prefix}/registry`,
        
        OPTIN           = `/${prefix}/optin`,
        OPTINSAMPLE     = `/${prefix}/optinsample`,

        DISABLED        = `/${prefix}/disabled`,
        RESET_PWD       = `/${prefix}/resetpw`,

        CANCEL         = `/${prefix}/cancel`,

        KITCHEN         = `/${prefix}/kitchen`
        */
    }

    export interface Props
    {
    }
}


export default AppRouter;

// eof
