//
import { GetAccount } from '@repo/api';
import { NetworkUtils } from '@repo/common';
import { RestfulEndpoint } from '@repo/endpoint';
import AccountService from '../services/AccountService';

//
// STUB — fetch the caller's account. Returns 501 until the account read is implemented.
// TODO: resolve the caller's accountId (from the acting context), read the `accounts` table, compose
//       the Account.Entity (+ optional billing/entitlement projections).
//
export class GetAccountImpl extends GetAccount
{
    private service : AccountService;

    constructor( service : AccountService )
    {
        super();
        this.service = service;
    }

    ///////////////////////////////////////////////////////////////////////////////////////////
    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        if( !auth.userId ) return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };
        this.service.log.info( "stub:GetAccount", { userId: auth.userId } );
        return { status: NetworkUtils.Status.NOT_IMPLEMENTED, data: { message: "account read not implemented yet" } };
    }
}

export default GetAccountImpl;
