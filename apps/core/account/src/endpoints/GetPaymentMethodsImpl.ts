//
import { GetPaymentMethods } from '@repo/api';
import { NetworkUtils } from '@repo/common';
import { RestfulEndpoint } from '@repo/endpoint';
import AccountService from '../services/AccountService';

// Stored payment methods for the acting account. SKELETON: empty until Stripe is wired (methods live there).
export class GetPaymentMethodsImpl extends GetPaymentMethods
{
    private service : AccountService;
    constructor( service : AccountService ) { super(); this.service = service; }

    ///////////////////////////////////////////////////////////////////////////////////////////
    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        if( !auth.userId )    return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };
        if( !auth.accountId ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "no acting account (X-Account)" } };
        return { status: NetworkUtils.Status.OK, data: { methods: [] } };
    }
}

export default GetPaymentMethodsImpl;
