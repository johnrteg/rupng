//
// application entry point
// This managed the routes and themes of the application
//
import React from 'react';
import { JSX } from "react";

//
import { PaletteMode, Theme, ThemeProvider, createTheme } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';

//
import '../css/App.css';
import { StringUtils, NetworkUtils, UserAgent } from '@repo/common';



//import ZendeskChatInput         from "../app/widgets/ZendeskChatInput";

//
import AppModel                  from "@model/AppModel";

//import Rup                      from "./definitions/RupContants";
import AppRouter        from "./AppRouter";
import ErrorBoundary    from "./ErrorBoundary";
import PubSubService    from '@model/service/PubSubService';
import Subscriber       from '@widgets/core/Subscriber';

//
//
//
// Add browser-based global error handlers
//
if ( typeof window !== "undefined" )
{
    window.onerror = function ( message: string | Event, source?: string, lineno?: number, colno?: number, error?: Error )
    {
        // Log or report the error
        console.error('App::Global error:', { message, source, lineno, colno, error } );
    };

    window.onunhandledrejection = function (event: PromiseRejectionEvent)
    {
        // Log or report the unhandled promise rejection
        console.error('App::Unhandled promise rejection:', event.reason );
    };
}


//
// 
//
export default function App() : JSX.Element
{
    const appmodel : AppModel = AppModel.instance();
    
    const [mode,setMode]            = React.useState< PaletteMode >( appmodel.ui.themeMode );
    const [theme,setTheme]          = React.useState< Theme | undefined >( undefined );
    const resizeTimer               = React.useRef< ReturnType<typeof setTimeout> | null >( null );
    const isPortrait                = React.useRef< boolean >( window.innerWidth < window.innerHeight );

    // Guard against overlapping async theme loads (latest request wins)

    //
    React.useEffect( () => componentLoaded(), [] );
    React.useEffect( () => () => componentUnloaded(), [] );
    React.useEffect( modeChanged, [mode] );
    React.useEffect( backgroundColorChanged, [theme] );

    //////////////////////////////////////////////////////////////////////////////////////////////
    function componentLoaded() : void
    {
        //console.log('0) App::componentLoaded', appdata.loaded );
        if( !appmodel.loaded )
        {
            appmodel.loaded = true;
        }

        window.addEventListener( 'resize', onWindowResize );

        appmodel.notifyAccountReadiness( AppModel.AccountNotifyStatus.READY  );
    }

    //////////////////////////////////////////////////////////////////////////////////////////////
    function componentUnloaded() : void
    {
        window.removeEventListener( 'resize', onWindowResize );
    }

    //////////////////////////////////////////////////////////////////////
    function onWindowResize( ) : void
    {
        if( resizeTimer.current )clearTimeout( resizeTimer.current );
        resizeTimer.current = setTimeout( doWindowResize, 250 );
    }

    //////////////////////////////////////////////////////////////////////
    function doWindowResize( ) : void
    {
        resizeTimer.current  = null;
        // todo: update breakpoints based any possible orientation change
        if( window.innerWidth < window.innerHeight )
        {
            // now portrait
            if( isPortrait.current )
            {
                isPortrait.current = false;
                //console.log('flipped');
            }
        }
        else    // landscape
        {
            if( !isPortrait.current )
            {
                isPortrait.current = true;
                //console.log('flipped');
            }
        }
    }

    //////////////////////////////////////////////////////////////////////////////////////////
    function onThemeChange( event : PubSubService.Event ) : void
    {
        //console.log( "1) App::onThemeChange", event );
        setMode( event );
    }

    ///////////////////////////////////////////////////////////////////////////////////////
    function backgroundColorChanged() : void
    {
        if( theme !== undefined )
        {
            document.body.style.backgroundColor = theme.palette.background.default;
        }
    }

    //////////////////////////////////////////////////////////////////////////////////////
    function modeChanged() : void
    {
        loadTheme();
    }

    /////////////////////////////////////////////////////////////////////////////////////////////////////////
    async function loadTheme() : Promise<void>
    {
        // bump sequence for a new load; anything older becomes stale
        //const seq : number = ++themeLoadSeq.current;

        const host_name : string = appmodel.hostName();

        //console.log( "2) App::loadTheme", host_name );

        // see if there is a domain specific theme and if there is not one, revert to localhost default
        const okDomain : boolean = await loadThemeDomain( host_name );
        if( !okDomain )
        {
            await loadThemeDomain( 'localhost' );
        }
    }

    /////////////////////////////////////////////////////////////////////////////////////////////////////////
    async function loadThemeDomain( domain : string ) : Promise<boolean>
    {
        const theme_uri : string = StringUtils.format( './assets/themes/{0}.{1}.json', domain, mode );
        const response  : any = await appmodel.server.get( theme_uri, null, { ContentType: NetworkUtils.MimeType.JSON } );

        //console.log( "3) App::loadThemeDomain get theme", domain, mode );

        // A missing host-specific theme should 404 so we fall back to 'localhost'. But an SPA edge
        // (e.g. CloudFront) may rewrite 404 → index.html with HTTP 200 — making response.ok true with
        // an HTML body. Require an actual theme shape (palette/typography) so the fallback still fires.
        const data : any = response.data;
        const isTheme : boolean = !!data && typeof data === "object" && ( !!data.palette || !!data.typography );

        if( response.ok && isTheme )
        {
            // adjust by the device it is on
            const ua : UserAgent.Info = UserAgent.parse( window.navigator.userAgent );

            let tablet_width  : number = 1024;
            let desktop_width : number = 1200;

            // adjust breakpoints for the device the site is running on
            if( ua.device === UserAgent.Device.MOBILE )
            {
                tablet_width  = window.innerWidth + 1;
                desktop_width = window.innerWidth * 1.2; // 20% smaller
            }
            else if( ua.device === UserAgent.Device.TABLET )
            {
                tablet_width  = window.innerWidth + 1;
                desktop_width = window.innerWidth * 1.2;    // 20% larger
            }

            // Force palette.mode to match current mode state (ignore/mask JSON mode mismatches)
            const themeData : any = response.data ?? {};
            const paletteFromJson : any = themeData.palette ?? {};

            //console.log( "4) App::loadThemeDomain set theme" );
            

            setTheme( createTheme( {  ...themeData,
                                    palette: { ...paletteFromJson, mode: mode, forceThemeRerender : true },
                                    
                                    breakpoints: { values: { xs: 0,
                                                            sm: 600,
                                                            md: 900,
                                                            lg: 1200,
                                                            xl: 1536,
                                                            mobile: 0,
                                                            tablet: tablet_width,
                                                            desktop: desktop_width } } } ) );
            appmodel.storage.setCookie( AppModel.Cookie.THEME, mode );
            return true;
        }
        else
        {
            return false;
        }
    }

    
    // ==========================================================================================
    return      <>
                <Subscriber event={ PubSubService.Type.THEME } onChange={ onThemeChange } />
                { theme !== undefined ? <ThemeProvider theme={ theme }>
                    <CssBaseline />{ /* applies theme text/background to <body> so inherited text (nav labels, etc.) flips with the mode */ }
                    <ErrorBoundary>
                        <AppRouter />
                        {/*<ZendeskChatInput />*/}
                    </ErrorBoundary>
                </ThemeProvider>
                : null }
                </>;
}


// eof