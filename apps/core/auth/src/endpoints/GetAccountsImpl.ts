//
import { GetAccounts } from '@repo/api';
import { NetworkUtils } from '@repo/common';
import { RestfulEndpoint } from '@repo/endpoint';
import AuthService from '../services/AuthService';

//
// STUB — the accounts the caller can act in. Returns empty until role_grants is wired.
// TODO: query the `role_grants` table (PK userId) → resolve account names + max role per account.
//
export class GetAccountsImpl extends GetAccounts
{
    private service : AuthService;

    ////////////////////////////////////////////////////////////////////////////////////////////////////////////
    constructor( service : AuthService )
    {
        super();
        this.service = service;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////////////////////
    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        if( !auth.userId ) return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };
        const reply : GetAccounts.Response = { accounts: [] };
        return { status: NetworkUtils.Status.OK, data: reply };
    }
}

export default GetAccountsImpl;
