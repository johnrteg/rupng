//
import React, { Suspense } from 'react';
import { JSX } from "react";



// others
import AppModel         from '@model/AppModel';
import PubSubService    from '@model/service/PubSubService';
import PageWaiting      from '@pages/common/PageWaiting';
import { Dashboard }    from '@pages/dashboard/Dashboard';
import { Login }        from '@pages/login/Login';
import { Register }     from '@pages/register/Register';
import { ForgotPassword }   from '@pages/login/ForgotPassword';
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
        new_routes.push( { path: AppRouter.Route.REGISTER , component: () => <Register /> } );
        new_routes.push( { path: AppRouter.Route.FORGOT_PASSWORD , component: () => <ForgotPassword /> } );
        //new_routes.push( { path: AppRouter.Route.REGISTRY , component: withLazyWrapper(Registry) } );

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
