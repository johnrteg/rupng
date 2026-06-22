//

import AppModel from "../AppModel";


export class AccountService
{
    private appmodel : AppModel;

    public id       : string;
   // public account  : GetAccount.Response | null = null;
    //public accounts : Array<AccountPref.Customer> = [];

    //////////////////////////////////////////////////////////////////////////////////////////////////////////////
    constructor( app : AppModel )
    {
        this.appmodel = app;
        this.id = "";
    }

    //////////////////////////////////////////////////////////////////////////////////////////////////////////////
    public makeEmpty() : void
    {
        //this.account    = null;
        this.id         = "";
        //this.accounts   = [];
    }

  


}

export namespace AccountService
{

}

export default AccountService
// EOF