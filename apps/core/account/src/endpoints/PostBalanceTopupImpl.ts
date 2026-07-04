//
import { PostBalanceTopup, Billing, Account } from '@repo/api';
import { NetworkUtils, ObjectUtils, type Type } from '@repo/common';
import { RestfulEndpoint } from '@repo/endpoint';
import { Events } from '@repo/system';
import AccountService from '../services/AccountService';
import { BillingStore } from './BillingStore';

//
// Add funds to the prepaid balance. SKELETON: real flow charges the default method via Stripe first — here
// we simply credit the persisted balance so the UI reflects the change on reload. Amount is minor units (>=1).
//
export class PostBalanceTopupImpl extends PostBalanceTopup
{
    private service : AccountService;
    constructor( service : AccountService ) { super(); this.service = service; }

    ///////////////////////////////////////////////////////////////////////////////////////////
    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        if( !auth.userId )   return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };
        const accountId : string | undefined = auth.accountId;
        if( !accountId )     return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "no acting account (X-Account)" } };

        const amountMinor : number = this.body?.amountMinor ?? 0;
        if( amountMinor < 1 ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "amount must be >= 1" } };

        const found : Type.Result<( Account.Entity & BillingStore.Row ) | undefined> =
            await this.service.dynamo.get<Account.Entity & BillingStore.Row>( "accounts", { accountId } );
        if( !found.ok )   return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "billing read failed" } };
        if( !found.data ) return { status: NetworkUtils.Status.NOT_FOUND, data: { message: "account not found" } };

        const state : BillingStore.State = BillingStore.hydrate( found.data.billing );
        const balance : Billing.AccountBalance = {
            balance:   { amountMinor: state.balance.balance.amountMinor + amountMinor, currency: state.balance.balance.currency },
            updatedAt: new Date().toISOString(),
        };

        const merged : Record<string, unknown> = { ...ObjectUtils.withDefaults( found.data, Account.DEFAULT ), accountId, billing: { ...state, balance } };
        const put = await this.service.dynamo.put( "accounts", merged );
        if( !put.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "billing write failed" } };

        void this.service.emit( Events.Object.ACCOUNT_ACCOUNT, Events.Verb.UPDATED, "account", accountId, accountId, merged, auth.userId );
        return { status: NetworkUtils.Status.OK, data: { balance } };
    }
}

export default PostBalanceTopupImpl;
