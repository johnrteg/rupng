//
import React, { Suspense } from 'react';
import { JSX } from "react";



// others
import AppModel         from '@model/AppModel';
import PubSubService    from '@model/service/PubSubService';
import PageWaiting      from '@pages/common/PageWaiting';
import { Dashboard }    from '@pages/dashboard/Dashboard';
import { ProfileDetails } from '@pages/profile/ProfileDetails';
import { ProfileDisplay } from '@pages/profile/ProfileDisplay';
import { ProfileSecurity } from '@pages/profile/ProfileSecurity';
import { ProfileNotifications } from '@pages/profile/ProfileNotifications';
import { AccountDetails } from '@pages/account/AccountDetails';
import { AccountBranding } from '@pages/account/AccountBranding';
import { AccountBilling } from '@pages/account/AccountBilling';
import { AccountUsers } from '@pages/account/AccountUsers';
import { AccountSubAccounts } from '@pages/account/AccountSubAccounts';
import { ContactsList } from '@pages/contacts/ContactsList';
import { Segments } from '@pages/contacts/Segments';
import { Campaigns } from '@pages/campaigns/Campaigns';
import { Schedule } from '@pages/schedule/Schedule';
import { MediaLibrary } from '@pages/media/MediaLibrary';
import { MediaBrowse } from '@pages/media/browse/MediaBrowse';
import { MediaAiGen } from '@pages/media/MediaAiGen';
import { MediaDownloads } from '@pages/media/MediaDownloads';
import { MediaStudio } from '@pages/media/MediaStudio';
import { Help } from '@pages/help/Help';
import { SettingsApi } from '@pages/settings/SettingsApi';
import { SettingsContacts } from '@pages/settings/SettingsContacts';
import { SettingsEmail } from '@pages/settings/SettingsEmail';
import { SettingsActions } from '@pages/settings/SettingsActions';
import { EmailTemplates } from '@pages/email/EmailTemplates';
import { MessagesSend } from '@pages/messages/MessagesSend';
import { MessagesSent } from '@pages/messages/MessagesSent';
import { MonitorDashboard } from '@pages/monitor/MonitorDashboard';
import { Login }        from '@pages/login/Login';
import { Register }     from '@pages/register/Register';
import { ForgotPassword }   from '@pages/login/ForgotPassword';
import { ActionLanding }    from '@pages/landing/ActionLanding';
import { AuthAction }       from '@repo/api';
import Subscriber       from '@widgets/core/Subscriber';
import ErrorPage        from '@pages/common/ErrorPage';
import StubPage         from '@widgets/app/StubPage';
import navModel         from '@widgets/app/navigation/navModel';


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

        // real nav destinations (built pages) — registered explicitly; skipped by the stub loop below
        new_routes.push( { path: "/profile/details", component: () => <ProfileDetails /> } );
        new_routes.push( { path: "/profile/display", component: () => <ProfileDisplay /> } );
        new_routes.push( { path: "/profile/security", component: () => <ProfileSecurity /> } );
        new_routes.push( { path: "/profile/notifications", component: () => <ProfileNotifications /> } );
        new_routes.push( { path: "/account/details", component: () => <AccountDetails /> } );
        new_routes.push( { path: "/account/branding", component: () => <AccountBranding /> } );
        new_routes.push( { path: "/account/billing", component: () => <AccountBilling /> } );
        new_routes.push( { path: "/account/users", component: () => <AccountUsers /> } );
        new_routes.push( { path: "/account/sub-accounts", component: () => <AccountSubAccounts /> } );
        new_routes.push( { path: "/campaigns", component: () => <Campaigns /> } );
        new_routes.push( { path: "/contacts/list", component: () => <ContactsList /> } );
        new_routes.push( { path: "/contacts/segments", component: () => <Segments /> } );
        new_routes.push( { path: "/schedule", component: () => <Schedule /> } );
        new_routes.push( { path: "/media/library", component: () => <MediaLibrary /> } );
        new_routes.push( { path: "/media/browse", component: () => <MediaBrowse /> } );
        new_routes.push( { path: "/media/ai-gen", component: () => <MediaAiGen /> } );
        new_routes.push( { path: "/media/downloads", component: () => <MediaDownloads /> } );
        new_routes.push( { path: "/media/studio", component: () => <MediaStudio /> } );
        new_routes.push( { path: "/help", component: () => <Help /> } );
        new_routes.push( { path: "/settings/api", component: () => <SettingsApi /> } );
        new_routes.push( { path: "/settings/contacts", component: () => <SettingsContacts /> } );
        new_routes.push( { path: "/settings/email", component: () => <SettingsEmail /> } );
        new_routes.push( { path: "/settings/actions", component: () => <SettingsActions /> } );
        new_routes.push( { path: "/studio/email-templates", component: () => <EmailTemplates /> } );
        new_routes.push( { path: "/messages/send", component: () => <MessagesSend /> } );
        new_routes.push( { path: "/messages/sent", component: () => <MessagesSent /> } );
        new_routes.push( { path: "/tools/monitor", component: () => <MonitorDashboard /> } );

        // least common (mixed - some critical, some lazy)
        new_routes.push( { path: AppRouter.Route.ROOT     , component: () => <Dashboard /> } );
        //new_routes.push( { path: AppRouter.Route.REGISTER , component: withLazyWrapper(SignUp) } );
        //new_routes.push( { path: AppRouter.Route.FORGOT   , component: withLazyWrapper(ForgotPassword) } );
        new_routes.push( { path: AppRouter.Route.LOGIN    , component: ( params : Login.Props ) => <Login {...params} /> } );
        new_routes.push( { path: AppRouter.Route.REGISTER , component: () => <Register /> } );
        new_routes.push( { path: AppRouter.Route.FORGOT_PASSWORD , component: () => <ForgotPassword /> } );
        // no-auth landing pages (opened from email links) — parse the token from the path; one component per type
        new_routes.push( { path: `${ AuthAction.PATHS[ AuthAction.Type.EMAIL_VERIFICATION ] }/:token`, component: ( params : { token : string } ) => <ActionLanding token={ params.token } type={ AuthAction.Type.EMAIL_VERIFICATION } /> } );
        new_routes.push( { path: `${ AuthAction.PATHS[ AuthAction.Type.PASSWORD_RESET ] }/:token`,     component: ( params : { token : string } ) => <ActionLanding token={ params.token } type={ AuthAction.Type.PASSWORD_RESET } /> } );
        new_routes.push( { path: `${ AuthAction.PATHS[ AuthAction.Type.MFA_CODE ] }/:token`,            component: ( params : { token : string } ) => <ActionLanding token={ params.token } type={ AuthAction.Type.MFA_CODE } /> } );
        new_routes.push( { path: `${ AuthAction.PATHS[ AuthAction.Type.ACCOUNT_INVITE ] }/:token`,      component: ( params : { token : string } ) => <ActionLanding token={ params.token } type={ AuthAction.Type.ACCOUNT_INVITE } /> } );
        new_routes.push( { path: `${ AuthAction.PATHS[ AuthAction.Type.UNSUBSCRIBE ] }/:token`,         component: ( params : { token : string } ) => <ActionLanding token={ params.token } type={ AuthAction.Type.UNSUBSCRIBE } /> } );
        //new_routes.push( { path: AppRouter.Route.REGISTRY , component: withLazyWrapper(Registry) } );

        // nav destinations from the shared nav model — each renders a Dashboard-like page (StubPage until
        // its real page exists), titled with a "Parent : Child" breadcrumb for children. /dashboard is
        // already mapped to the real Dashboard above, so skip it.
        const built : Set<string> = new Set( new_routes.map( ( r : Route ) => r.path ) );   // don't stub a real page
        for( const page of navModel.pages() )
        {
            if( !page.route || built.has( page.route ) ) continue;
            new_routes.push( { path: page.route, component: () => <StubPage title={ page.title } /> } );
        }

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
        ROOT            = `/`,
        LOGIN           = `/signin`,
        REGISTER        = `/register`,
        FORGOT_PASSWORD = `/forgot-password`,
        DASHBOARD       = `/dashboard`,
    }

    export interface Props
    {
    }
}


export default AppRouter;

// eof
