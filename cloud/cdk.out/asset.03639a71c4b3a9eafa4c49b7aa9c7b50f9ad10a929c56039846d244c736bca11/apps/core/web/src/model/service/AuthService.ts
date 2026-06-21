//


import PasswordPolicy from "../PasswordPolicy";
import AppModel from "../AppModel";


export default class AuthService
{
    private appdata : AppModel;

    public login                : any | null = null;        // todo
    public passwordPolicies     : PasswordPolicy;

    //////////////////////////////////////////////////////////////////////////////////////////////////////////////
    constructor( app : AppModel )
    {
        this.appdata = app;
        this.passwordPolicies   = new PasswordPolicy();
    }

    //////////////////////////////////////////////////////////////////////////////////////////////////////////////
    public makeEmpty() : void
    {
        this.login = null;
        this.passwordPolicies = new PasswordPolicy();
    }


    //////////////////////////////////////////////////////////////////////////////////////////////////////////////
    /**
    * Returns if the current login session is valid.
    * @return true if the session if valid, false if it is not.
    */
    public validSession() : boolean
    {
        return this.login !== null;
    }           

}