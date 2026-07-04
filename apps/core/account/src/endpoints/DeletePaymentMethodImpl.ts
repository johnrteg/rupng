//
import { DeletePaymentMethod } from '@repo/api';
import { NetworkUtils } from '@repo/common';
import { RestfulEndpoint } from '@repo/endpoint';
import AccountService from '../services/AccountService';

// Detach a payment method. SKELETON: real flow detaches the Stripe PaymentMethod. No stored methods yet, so
// this is a no-op that reports success for a well-formed request.
export class DeletePaymentMethodImpl extends DeletePaymentMethod
{
    private service : AccountService;
    constructor( service : AccountService ) { super(); this.service = service; }

    ///////////////////////////////////////////////////////////////////////////////////////////
    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        if( !auth.userId )    return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };
        if( !auth.accountId ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "no acting account (X-Account)" } };
        const methodId : string = this.query?.methodId ?? "";
        if( !methodId )       return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "methodId required" } };
        return { status: NetworkUtils.Status.OK, data: { removed: true } };
    }
}

export default DeletePaymentMethodImpl;
