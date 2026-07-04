//
//
//
import { RestfulService } from "@repo/endpoint";
import { GetBootstrap, GetSession, PostSessionRefresh } from "@repo/api";

import { DateUtils, NetworkUtils } from "@repo/common";

import WebSocketService     from "./service/WebsocketService";
import StorageService       from "./service/StorageService";
import LocalStorage         from "./service/LocalStorage";
import LogService           from "./service/LogService";
import PubSubService        from "./service/PubSubService";
import CacheService         from "./service/CacheService";
import AuthService from "./service/AuthService";
import AccountService from "./service/AccountService";
import UiService from "./service/UiService";
import LocaleService from "./service/LocaleService";


export class AppModel
{
    private static _instance : AppModel;

    /** guards refresh re-entry — so the refresh call's own 401 (or concurrent 401s) can't recurse/loop. */
    private refreshInFlight : boolean = false;

    public loaded               : boolean = false;    // to deal with duplicate load events

    // communications
    public server               : RestfulService;
    public pubsub               : PubSubService;

    public cache                : CacheService;

    // web socket
    public ws                   : WebSocketService;

    // state
    public storage              : StorageService;
    public localStorage         : LocalStorage;     // typed window.localStorage wrapper (session tokens + keys)

    public ui              : UiService;

    // log
    public log                  : LogService;

    public auth : AuthService;
    public account : AccountService;

    public config : GetBootstrap.Config;

    public pingTimer            : ReturnType<typeof setTimeout> | null = null;


    ////////////////////////////////////////////////////////////////////////////////////////////////
    constructor()
    {
        // determine the kind of host the client is running on
        this.config = GetBootstrap.DEFAULT;

        // setup api service to backend server
        // must be first thing to allow other service to leverage backend API
        const url : NetworkUtils.Url = NetworkUtils.parseUrl( window.document.URL );
        this.server = new RestfulService( NetworkUtils.url( url.protocol, url.domain, url.port, null, null ),
                                        {},
                                        10 * DateUtils.Time.SECONDS_TO_MS,    // timeout.  make this configurable
                                        null, //Cookie.Type.CSRF,
                                        null, //Cookie.Type.TZ,
                                        AppModel.ServerMonitor );

        // re-apply a persisted session token (survives reload) as the Authorization bearer
        this.localStorage = new LocalStorage();
        const savedSession : string | null = this.localStorage.sessionToken();
        if( savedSession ) this.server.setHeader( "Authorization", `Bearer ${savedSession}` );

        // init
        this.log        = new LogService();
        this.cache      = new CacheService();
        this.storage    = new StorageService();
        this.ws         = new WebSocketService( this );
        this.pubsub     = new PubSubService();
        this.auth       = new AuthService( this );
        this.ui         = new UiService( this );
        this.account    = new AccountService( this );

        // restore the signed-in session from the cached token (survives a page refresh): decode its claims
        // so validSession() is true and guarded pages render without a re-login. An expired token decodes
        // but validSession() rejects it → the user lands on sign-in. (Bearer header was re-applied above.)
        if( savedSession ) this.auth.setSession( savedSession );

        // transparently recover from access-token expiry: on a 401, refresh once + retry the original call.
        this.server.setUnauthorizedHandler( () => this.refreshSession() );
    }

    //////////////////////////////////////////////////////////////////////////////////////////////////
    /**
    * Returns the singleton instance of this class.  There can only be one of these.
    *
    * @return Returns single instance of the AppData class
    *
    * @example const appdata : AppData = AppData.instance();
    */
    public static instance() : AppModel
    {
        if( AppModel._instance == null )
        {
            AppModel._instance = new AppModel();
        }
        return AppModel._instance;
    }


    ////////////////////////////////////////////////////////////////////////////////////////////////////////////
    /**
    * Hooks into RestfulService server connection for requests being made.  It is hooked in during the instantiation of RestfulService.
    * This will report network requests back to Google Analytics so we can see how remote clients are seeing network requests.
    *
    * @param method Type of network request (e.g. GET, POST, PUT, etc).
    * @param url URL of the request.
    * @param status Status of the request (e.g. 200, 400, 404, etc. )
    * @param duration Duration in milliseconds that it took to make and then receive the request from the user's browser.
    *
    */
    private static ServerMonitor( method: NetworkUtils.Method, url : string, status: number, duration: number ) : void
    {
        //this.log.info( 'ServerMonitor', method, url, status, duration );
        if( AppModel.instance().cache.tracker )
        {
        /*
            ReactGA.send({  hitType         : Analytics.Type.TIMING,
                            eventCategory   : "Server",
                            eventAction     : StringUtils.format( "{0}:{1}", method, url ),
                            eventLabel      : status.toString(),
                            eventValue      : duration });
        */
        }
        
    }

    //////////////////////////////////////////////////////////////////////////////////////////////////
    public hostName() : string
    {
        const whitelabel : string | null = this.storage.getStorage( 'whitelabel' );
        const url : NetworkUtils.Url = NetworkUtils.parseUrl( window.document.URL );
        return whitelabel !== null ? whitelabel : url.domain;
    }

    //////////////////////////////////////////////////////////////////////////////////////////////////
    /**
    * Makes the instance "empty" by setting the default values needed prior to a user's login.
    *
    */
    private makeEmpty() : void
    {
        this.log.makeEmpty();
        this.storage.makeEmpty();
        this.cache.makeEmpty();
        this.ws.makeEmpty();
        this.ui.makeEmpty();

        this.refreshInit();

        if( this.pingTimer )clearTimeout( this.pingTimer );
        this.pingTimer          = null;
    }

    /////////////////////////////////////////////////////////////////////////////////////////////////////////////
    /**
    * If there are parameters in the browser's URL (e.g. /path?foo=bar), this will remove it and just process
    * the path in the current url.  This is needed when the user changes accounts that the current parameters
    * would protentially be invalid.
    */
    public clearUrlParams() : boolean
    {
        //this.log.info( 'clearUrlParams', window.location.pathname, window.location.search );
        if( window.location.search !== "" )
        {
            this.goto( window.location.pathname, [], null, true );
            return true;
        }
        else
            return false;
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    /**
    * Goto a specified url / page in the application.  This should be the only way to access another page in the application.
    *
    * @param url Base relative (e.g. /page) to navigate to
    * @param path Optional parameter to append the url path.
    * @param parameters Optioanl parameters (e.g. foo=bar) that would get appended to the url.
    * @param force Optional, and probably unnessary parameters, to force the page to update in case the brwoser is already there
    *
    * @example appdata.goto( AppRouter.DASHBOARD );
    * @example appdata.goto( AppRouter.CONTACTS, ['tab','groups'] );
    * @example appdata.goto( AppRouter.CONTACTS, ['tab','groups'], { color : 'red' } );
    *
    */
    public goto( url : string, path? : Array<string>, parameters : any = null, force : boolean = false ) : void
    {
        //this.log.info( 'AppData::goto', url );
        let new_url : string = url;
        if( path !== undefined && path.length > 0 )
        {
            new_url += "/" + path.join('/');
        }

        // add in any parameters
        if( parameters !== null )
        {
            const params : string = RestfulService.queryString( parameters );
            if( params !== "" )new_url += ( "?" + params );
        }

        // there is a break in AppRouter too, unless forced
        if( window.location.pathname !== new_url || force )
        {
            window.history.pushState( parameters != null ? parameters : {}, '', new_url );
            this.pubsub.publish( PubSubService.Type.ROUTE, new_url );
        }
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    /** Store the auth session: send the access token as the `Authorization` bearer + persist it (and, when
     *  given, the refresh token) across reloads, and decode its claims so the app knows it's signed in.
     *  `refreshToken` is optional so a refresh (which returns only a new access token) keeps the cached one. */
    public async setSession( token : string, refreshToken? : string ) : Promise<void>
    {
        this.localStorage.storeSession( token, refreshToken );
        this.server.setHeader( "Authorization", `Bearer ${token}` );
        this.auth.setSession( token );   // decode claims → mark authenticated so guarded pages (dashboard) render
        await this.loadSessionUser();     // fetch + cache the user's profile (auth/GetSession) — non-blocking
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    /** Fetch the signed-in user's profile (auth/GetSession) and cache it under `auth.user`, then publish a
     *  LOGIN event so the UI (e.g. the account menu) re-renders with the real name. Best-effort + non-blocking
     *  (token claims already authenticated the session); a failure leaves the menu on its token/"Account"
     *  fallback. The 401 hook covers an expired token (refresh + retry). */
    private async loadSessionUser() : Promise<void>
    {
        if( !this.auth.validSession() ) return;
        const reply : RestfulService.Reply<GetSession.Response> = await this.server.fetch( new GetSession() );
        if( reply.ok && reply.data )
        {
            this.auth.setUser( reply.data );
            this.pubsub.publish( PubSubService.Type.LOGIN, reply.data );
            await this.account.load();   // load the accounts the user can act in + pick the current one
        }
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    /** Log out (sign-out): drop both tokens, the bearer header, and the decoded session + cached profile. */
    public logout() : void
    {
        this.localStorage.clearSession();
        this.server.deleteHeader( "Authorization" );
        this.server.deleteHeader( "X-Account" );
        this.auth.setSession( null );
        this.account.makeEmpty();
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    /**
     * Exchange the cached refresh token for a fresh access token (Cognito REFRESH_TOKEN_AUTH via
     * `POST /session/refresh`). Wired as the RestfulService 401-recovery hook AND called proactively on
     * boot, so a session survives the ~1h access-token TTL without a re-login. Re-entry guarded so the
     * refresh call's OWN 401 (or concurrent 401s) can't recurse. On success the new access token is stored
     * (the refresh token is unchanged); on failure the session is cleared and the user must sign in again.
     */
    public async refreshSession() : Promise<boolean>
    {
        if( this.refreshInFlight ) return false;
        const refreshToken : string | null = this.localStorage.refreshToken();
        if( !refreshToken ) return false;

        this.refreshInFlight = true;
        try
        {
            const reply : RestfulService.Reply<PostSessionRefresh.Response> = await this.server.fetch( new PostSessionRefresh( { refreshToken } ) );
            if( reply.ok && reply.data?.sessionToken ) { this.setSession( reply.data.sessionToken ); return true; }
            this.logout();                // refresh token rejected/expired → force a fresh sign-in
            return false;
        }
        catch { this.logout(); return false; }
        finally { this.refreshInFlight = false; }
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    public async setLogin() : Promise<void>
    {
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    public async setAccount( id : string ) : Promise<void>
    {
    }


    ////////////////////////////////////////////////////////////////////////////////////////////////
    /**
    * Log the current user out of the application.  This will clean up any internal state so that
    * any new login will be fresh.
    */
    public async setLogout() : Promise<void>
    {
    }

    /////////////////////////////////////////////////////////////////////////////////////////////////////////////
    /**
    * Callback and initiator to update the current login state from the server as well as set up the next interval checkin
    */
    public async updateLogin() : Promise<void>
    {
    }

    ////////////////////////////////////////////////////////////////////////////////////////////////////////////
    /**
    * Refresh the initializatio the singleton state of the application.  This includes items like language, theme, and settings.
    */
    private async refreshInit() : Promise<void>
    {
            //
            // is there an active session?
            //
            await this.hasActiveSession();


        
    }

    ////////////////////////////////////////////////////////////////////////////////////////////////
    /**
    * Checks if the current account has been loaded and set and if it has, it will send out an event to the application
    */
    public notifyAccountReadiness( status : AppModel.AccountNotifyStatus ) : void
    {
        if( this.loaded && this.auth.validSession() && this.account.current !== null )
        {
            //this.pubsub.publish( PubSubService.Type.ACCOUNT, { status : status } as Rup.AccountNotify );
        }
    }

    /////////////////////////////////////////////////////////////////////////////////////////////////////////
    /**
    * Checks if the current application has an active login session and if it does, access needed state.
    * This occurs when the browser may have been refreshed and cached state would not exist yet.
    */
    public async hasActiveSession() : Promise<void>
    {
        // boot: if the cached access token is missing/expired but we still hold a refresh token, mint a fresh
        // access token NOW (before routing decides) so a returning user stays signed in across the access TTL.
        if( !this.auth.validSession() && this.localStorage.refreshToken() )
            await this.refreshSession();          // refresh path: setSession already fetches the profile
        else if( this.auth.validSession() )
            await this.loadSessionUser();         // cached-valid-token path: setSession wasn't called → fetch it now
    }

    /////////////////////////////////////////////////////////////////////////////////////////////////////////
    public hasSessionCookie() : boolean
    {
        return this.auth.validSession();
    }

    ////////////////////////////////////////////////////////////////////////////////////////////////
    /**
    * Inital call during boot straping of the application.  Once initialized, it will call the callback main function
    * which will then load the react application.
    */
    public async initialize( main : Function ) : Promise<void>
    {
        //
        // get initial state of the application
        //
        const request : GetBootstrap = new GetBootstrap();
        const response : RestfulService.Reply<GetBootstrap.Response> = await this.server.fetch( request );
        if( response.ok )
        {
            this.log.info( "bootstrap", response.data );
            this.config = response.data as GetBootstrap.Config;
        }

        // do any initialization before running the app
        await this.refreshInit();

        this.log.info('initialized');

        // start the app
        main();
    }

    /////////////////////////////////////////////////////////////////////////////////////////////////////////
    // wrapper function
    public label( id : string, options? : LocaleService.LabelOptions ) : string
    {
       return this.ui.locale.label( id, options );
    }


}

export namespace AppModel
{   
    // for now
    export enum AccountNotifyStatus
    {
        PENDING = "pending",
        READY   = "ready"
    }

    export enum Cookie
    {
        LANGUAGE    = "sb-lang",
        THEME       = "sb-theme",
        CSRF        = "bk-csrf",
        TZ          = "bk-tz",
    }
}

export default AppModel;
