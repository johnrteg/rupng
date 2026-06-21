//
import Cookies from 'js-cookie';

export default class StorageService
{
    //////////////////////////////////////////////////////////////////////////////////////////////////////////////
    constructor()
    {
    }

    //////////////////////////////////////////////////////////////////////////////////////////////////////////////
    public makeEmpty() : void
    {
    }

    //////////////////////////////////////////////////////////////////////////////////////////////////////////////
    /**
    * Set cookies.
    * @param name Name of the cookie
    * @param value Value of the cookie to be stored.
    * @param expire_days Number of days before the cookie expires.  By default, it is 7 days.  Null will allow no expiration.
    * @param secure Optional paramter to not have the cookie secure.  By default, it is set to be secured.
    */
    public setCookie(   name        : string,
                        value       : string | number | boolean,
                        expire_days : number | null = 7,
                        secure      : boolean = true ) : void
    {
        // https://www.npmjs.com/package/js-cookie/v/2.2.1
        Cookies.set( name, value.toString(), {  expires : expire_days ? expire_days : undefined,
                                                secure : secure,
                                                path : '/' } );
    }

    //////////////////////////////////////////////////////////////////////////////////////////////////////////////
    /**
    * Get a currently saved cookie.
    * @param name Name of the cookie
    * @return Value of the cookie that may have been previously stored, and if it is not, will return undefined.
    */
    public getCookie( name : string ) : string | undefined
    {
        return Cookies.get( name );
    }

    //////////////////////////////////////////////////////////////////////////////////////////////////////////////
    /**
    * Delete a currently saved cookie.  If the cookie does not exist, this will have no impact.
    * @param name Name of the cookie
    */
    public deleteCookie( name : string ) : void
    {
        Cookies.remove( name, { path: '/' } );
    }

    //////////////////////////////////////////////////////////////////////////////////////////////////////////////
    /**
    * Persist state in the browser local storage.  Take into account that different logins may exist in the same browser
    * so state should be taken into account so state does not bleed over to another user's login.
    * @param name Name of the cookie
    * @param value Value to be stored along with the name.
    */
    public setStorage( name : string, value : string ) : void
    {
        localStorage.setItem( name, value );
    }
    //////////////////////////////////////////////////////////////////////////////////////////////////////////////
    /**
    * Get a currently saved browser storage value.
    * @param name Name of the stored data
    * @return Value of the data that may have been previously stored, and if it is not, will return null.
    */
    public getStorage( name : string ) : string | null
    {
        return localStorage.getItem( name );
    }
    //////////////////////////////////////////////////////////////////////////////////////////////////////////////
    /**
    * Delete a previously stored data.
    * @param name Name of the data to be deleted.
    */
    public deleteStorage( name : string ) : void
    {
        localStorage.removeItem( name );
    }
}