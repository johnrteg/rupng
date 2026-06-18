//
//
//
import { RestfulService } from "@repo/endpoint";

import { DateUtils, NetworkUtils } from "@repo/common";

import WebSocketService     from "./service/WebsocketService";
import StorageService       from "./service/StorageService";
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

    public loaded               : boolean = false;    // to deal with duplicate load events

    // communications
    public server               : RestfulService;
    public pubsub               : PubSubService;

    public cache                : CacheService;

    // web socket
    public ws                   : WebSocketService;

    // state
    public storage              : StorageService;

    public ui              : UiService;

    // log
    public log                  : LogService;

    public auth : AuthService;
    public account : AccountService;

    public pingTimer            : ReturnType<typeof setTimeout> | null = null;


    ////////////////////////////////////////////////////////////////////////////////////////////////
    constructor()
    {
        // determine the kind of host the client is running on
        

        // setup api service to backend server
        // must be first thing to allow other service to leverage backend API
        const url : NetworkUtils.Url = NetworkUtils.parseUrl( window.document.URL );
        this.server = new RestfulService( NetworkUtils.url( url.protocol, url.domain, url.port, null, null ),
                                        {},
                                        10 * DateUtils.Time.SECONDS_TO_MS,    // timeout.  make this configurable
                                        null, //Cookie.Type.CSRF,
                                        null, //Cookie.Type.TZ,
                                        AppModel.ServerMonitor );

        // init
        this.log        = new LogService();
        this.cache      = new CacheService();
        this.storage    = new StorageService();
        this.ws         = new WebSocketService( this );
        this.pubsub     = new PubSubService();
        this.auth       = new AuthService( this );
        this.ui         = new UiService( this );
        this.account    = new AccountService( this );
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
        if( this.loaded && this.auth.validSession() && this.account.id !== "" )
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
    }

    /////////////////////////////////////////////////////////////////////////////////////////////////////////
    public hasSessionCookie() : boolean
    {
        return false;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////////
    /**
    * Inital call during boot straping of the application.  Once initialized, it will call the callback main function
    * which will then load the react application.
    */
    public async initialize( main : Function ) : Promise<void>
    {
        // do any initialization before running the app
        await this.refreshInit();

        console.log('starting');

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
