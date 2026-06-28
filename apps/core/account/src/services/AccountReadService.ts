//
import AccountService from './AccountService';

import GetAccountImpl from '../endpoints/GetAccountImpl';

//
// READ role — read-only account lookups (get account, resolved entitlements, …). Scales independently
// from the main role so read floods can't starve writes. STUB impls for now.
//
export class AccountReadService extends AccountService
{
    /////////////////////////////////////////////////////////////////////
    constructor()
    {
        super( AccountService.Role.READ );
    }

    /////////////////////////////////////////////////////////////////////
    protected override async registerEndpoints() : Promise<void>
    {
        await super.registerEndpoints();          // keeps /health + /version
        this.register( new GetAccountImpl( this ) );
    }
}

export default AccountReadService;
