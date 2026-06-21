//

import AppModel      from "@model/AppModel";
import LocaleService      from "./LocaleService";

import { DateUtils, NetworkUtils, StringUtils } from "@repo/common";
import PubSubService from "./PubSubService";

export enum ThemeMode
{
    LIGHT = "light",
    DARK  = "dark",
}

export default class UiService
{
    private appmodel : AppModel;

    public themeMode            : ThemeMode = ThemeMode.LIGHT;
    public locale               : LocaleService;

    //////////////////////////////////////////////////////////////////////////////////////////////////////////////
    constructor( app : AppModel )
    {
        this.appmodel = app;
        this.locale = new LocaleService();

        this.init();
    }

    //////////////////////////////////////////////////////////////////////////////////////////////////////////////
    private async init() : Promise<void>
    {
        // set the favorite icon
        UiService.setFavicon( this.getFavoriteIconUrl() );

        // language setting
        const cookie_lang : string | undefined = this.appmodel.storage.getCookie( AppModel.Cookie.LANGUAGE );
        this.setLanguage( cookie_lang ? cookie_lang : 'en-US' );

        // get server languages
        const lang_response : any = await this.appmodel.server.get( '/assets/language/index.json', null, { ContentType: NetworkUtils.MimeType.JSON } );
        if( lang_response.ok )
        {
            this.locale.languages = lang_response.data;
        }

        // check theme color scheme of the OS
        const scheme : boolean = window.matchMedia( "(prefers-color-scheme: dark)" ).matches;
        this.themeMode = scheme ? ThemeMode.DARK : ThemeMode.LIGHT;

        // override if saved as a cookie preference
        this.themeMode = this.appmodel.storage.getCookie( AppModel.Cookie.THEME ) ? this.appmodel.storage.getCookie( AppModel.Cookie.THEME ) as ThemeMode : this.themeMode;
    }

    //////////////////////////////////////////////////////////////////////////////////////////////////////////////
    public makeEmpty() : void
    {

    }

    /////////////////////////////////////////////////////////////////////////////////////////////////////////////
    public parseObjectDates( data : any, fields: Array<string> ) : any
    {
        const local : LocaleService = this.locale;

        // add any other date/time items that might need to be converted

        //
        // internal function - returns a deep copy with the date fields formatted,
        // leaving the original input untouched
        //
        function formatDates( obj : any ) : any
        {
            if( Array.isArray( obj ) )
            {
                return obj.map( ( item : any ) => formatDates( item ) );
            }

            if( obj && typeof obj === "object" )
            {
                const copy : any = {};
                for( const key in obj )
                {
                    if( fields.includes( key ) && obj[key] )
                    {
                        copy[key] = local.dateTime( DateUtils.parse( obj[key] ), LocaleService.Format.LONG );
                    }
                    else
                    {
                        copy[key] = formatDates( obj[key] );
                    }
                }
                return copy;
            }

            return obj;
        }
        return formatDates( data );
    }

    /////////////////////////////////////////////////////////////////////////////////////////////////////////////
    /**
    * Return the banner image that is used in the menu bar and other parts of the application.  The image is
    * based on the host being served to the client to allow for white label images.  Each sub/domain can have a 
    * different image returned and displayed in the browser.
    */
    public getHeaderImageUrl() : string
    {
        //const url : Network.Url = Network.parseUrl( window.document.URL );
        return StringUtils.format( "/assets/banner/{0}.png", this.appmodel.hostName()  );
    }

    /////////////////////////////////////////////////////////////////////////////////////////////////////////////
    public getFavoriteIconUrl() : string
    {
        //const url : Network.Url = Network.parseUrl( window.document.URL );
        return StringUtils.format( "/assets/favicon/{0}.png", this.appmodel.hostName() );
    }

    /////////////////////////////////////////////////////////////////////////////////////////////////////////////
    public static setFavicon( url : string ) : void
    {
        const head : HTMLHeadElement = document.head || document.getElementsByTagName('head')[0];

        let link : HTMLLinkElement | null = document.querySelector<HTMLLinkElement>("link[rel='icon']")
                                        || document.querySelector<HTMLLinkElement>("link[rel='shortcut icon']");

        if( !link )
        {
            link = document.createElement('link');
            link.rel = 'icon';
            head.appendChild( link );
        }

        // cache buster
        const cacheBusted : string = url.includes('?') ? `${url}&v=${Date.now()}` : `${url}?v=${Date.now()}`;
        link.href = cacheBusted;
    }


    ///////////////////////////////////////////////////////////////////////////////////////////////////////////////
    /**
    * Set's the current theme mode (light or dark) of the application.
    *
    * @param theme The mode to set.  Either ThemeMode.LIGHT OR ThemeMode.DARK.
    */
    public setTheme( mode : ThemeMode ) : void
    {
        this.themeMode = mode;
        this.appmodel.pubsub.publish( PubSubService.Type.THEME, this.themeMode );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    /**
    * Set's the current language for the application.  Labels can be localized and externalized to a language file.
    * The language file is a JSON file that contains a mapping between a 'tag' and the localized label.
    * Switching languages will load the new file and flush that app to use the new labels.
    * New language files are kept in /language and are copied to the public web directory on building the app.
    *
    * @param lang Language to load (e.g. 'en-US')
    */
    public async setLanguage( lang : string ) : Promise<void>
    {
        const language_uri : string = StringUtils.format( '/assets/language/{0}.json', lang );
        const response : any = await this.appmodel.server.get( language_uri, null, { ContentType: NetworkUtils.MimeType.JSON } );
        if( response.ok )
        {
            this.locale.setLanguage( lang, response.data );
            this.appmodel.storage.setCookie( AppModel.Cookie.LANGUAGE, lang );
            this.appmodel.pubsub.publish( PubSubService.Type.LANGUAGE, lang );
        }
        else
        {
            console.error('Unable to load language file for', lang );
        }
            
    }


}