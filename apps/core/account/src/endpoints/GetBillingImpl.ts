//
import { GetBilling, Billing, Account } from '@repo/api';
import { NetworkUtils, type Type } from '@repo/common';
import { RestfulEndpoint } from '@repo/endpoint';
import AccountService from '../services/AccountService';
import { BillingStore } from './BillingStore';

//
// The account/billing overview in one read. SKELETON: costs/plan/methods are empty until Stripe + plans
// land; balance + settings are the persisted parts (stored on the account row under `billing`). The billing
// address resolves from the account address when `billingAddressSameAsAccount`, else from the stored override.
//
export class GetBillingImpl extends GetBilling
{
    private service : AccountService;
    constructor( service : AccountService ) { super(); this.service = service; }

    ///////////////////////////////////////////////////////////////////////////////////////////
    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        if( !auth.userId )    return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };
        const accountId : string | undefined = auth.accountId;
        if( !accountId )      return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "no acting account (X-Account)" } };

        const found : Type.Result<( Account.Entity & BillingStore.Row ) | undefined> =
            await this.service.dynamo.get<Account.Entity & BillingStore.Row>( "accounts", { accountId } );
        if( !found.ok )   return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "billing read failed" } };
        if( !found.data ) return { status: NetworkUtils.Status.NOT_FOUND, data: { message: "account not found" } };

        const billing        : BillingStore.State = BillingStore.hydrate( found.data.billing );
        const billingAddress : Type.Address | undefined = billing.settings.billingAddressSameAsAccount
            ? found.data.address
            : billing.billingAddress;

        const overview : Billing.Overview = {
            planName:       undefined,          // no plan catalog yet
            subscription:   undefined,
            costs:          [],                 // "what's charged" — empty until pricing lands
            balance:        billing.balance,
            settings:       billing.settings,
            billingAddress: billingAddress,
            defaultMethod:  undefined,          // no methods until Stripe
        };
        return { status: NetworkUtils.Status.OK, data: { overview } };
    }
}

export default GetBillingImpl;
