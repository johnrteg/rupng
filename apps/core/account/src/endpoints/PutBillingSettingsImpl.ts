//
import { PutBillingSettings, Billing, Account } from '@repo/api';
import { NetworkUtils, ObjectUtils, type Type } from '@repo/common';
import { RestfulEndpoint } from '@repo/endpoint';
import { Events } from '@repo/system';
import AccountService from '../services/AccountService';
import { BillingStore } from './BillingStore';

//
// Update per-account billing settings (payment rail, auto-reload, and whether the billing address mirrors
// the account). When not "same as account", an explicit `billingAddress` override is stored. Persisted onto
// the account row under `billing`.
//
export class PutBillingSettingsImpl extends PutBillingSettings
{
    private service : AccountService;
    constructor( service : AccountService ) { super(); this.service = service; }

    ///////////////////////////////////////////////////////////////////////////////////////////
    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        if( !auth.userId )   return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };
        const accountId : string | undefined = auth.accountId;
        if( !accountId )     return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "no acting account (X-Account)" } };

        const found : Type.Result<( Account.Entity & BillingStore.Row ) | undefined> =
            await this.service.dynamo.get<Account.Entity & BillingStore.Row>( "accounts", { accountId } );
        if( !found.ok )   return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "billing read failed" } };
        if( !found.data ) return { status: NetworkUtils.Status.NOT_FOUND, data: { message: "account not found" } };

        const state : BillingStore.State = BillingStore.hydrate( found.data.billing );
        const settings : Billing.BillingSettings = {
            billingType:                 this.body?.billingType                 ?? state.settings.billingType,
            autoReload:                  this.body?.autoReload                  ?? state.settings.autoReload,
            billingAddressSameAsAccount: this.body?.billingAddressSameAsAccount ?? state.settings.billingAddressSameAsAccount,
        };
        // keep an explicit override only while decoupled from the account address
        const billingAddress : Type.Address | undefined = settings.billingAddressSameAsAccount
            ? undefined
            : ( this.body?.billingAddress ?? state.billingAddress );

        const next : BillingStore.State = { ...state, settings, billingAddress };
        const merged : Record<string, unknown> = { ...ObjectUtils.withDefaults( found.data, Account.DEFAULT ), accountId, billing: next };
        const put = await this.service.dynamo.put( "accounts", merged );
        if( !put.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "billing write failed" } };

        const effectiveAddress : Type.Address | undefined = settings.billingAddressSameAsAccount ? found.data.address : billingAddress;
        void this.service.emit( Events.Object.ACCOUNT_ACCOUNT, Events.Verb.UPDATED, "account", accountId, accountId, merged, auth.userId );
        return { status: NetworkUtils.Status.OK, data: { settings, billingAddress: effectiveAddress } };
    }
}

export default PutBillingSettingsImpl;
