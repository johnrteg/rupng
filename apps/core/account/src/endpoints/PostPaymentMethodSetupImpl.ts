//
import { PostPaymentMethodSetup } from '@repo/api';
import { NetworkUtils } from '@repo/common';
import { RestfulEndpoint } from '@repo/endpoint';
import AccountService from '../services/AccountService';

// Begin adding a card. SKELETON: real flow creates a Stripe SetupIntent and returns its client secret; the
// UI would confirm it with Stripe.js. Empty string signals "not wired yet".
export class PostPaymentMethodSetupImpl extends PostPaymentMethodSetup
{
    private service : AccountService;
    constructor( service : AccountService ) { super(); this.service = service; }

    ///////////////////////////////////////////////////////////////////////////////////////////
    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        if( !auth.userId )    return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };
        if( !auth.accountId ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "no acting account (X-Account)" } };
        return { status: NetworkUtils.Status.OK, data: { clientSecret: "" } };
    }
}

export default PostPaymentMethodSetupImpl;
