//
import AccountService from './AccountService';

import GetAccountImpl from '../endpoints/GetAccountImpl';
import PutAccountImpl from '../endpoints/PutAccountImpl';
import GetMembershipsImpl from '../endpoints/GetMembershipsImpl';
import GetMembersImpl from '../endpoints/GetMembersImpl';
import PatchMemberImpl from '../endpoints/PatchMemberImpl';
import DeleteMemberImpl from '../endpoints/DeleteMemberImpl';
import GetInvitesImpl from '../endpoints/GetInvitesImpl';
import PostInviteImpl from '../endpoints/PostInviteImpl';
import PostInviteResendImpl from '../endpoints/PostInviteResendImpl';
import DeleteInviteImpl from '../endpoints/DeleteInviteImpl';

import GetBillingImpl from '../endpoints/GetBillingImpl';
import PostBalanceTopupImpl from '../endpoints/PostBalanceTopupImpl';
import GetPaymentMethodsImpl from '../endpoints/GetPaymentMethodsImpl';
import PostPaymentMethodSetupImpl from '../endpoints/PostPaymentMethodSetupImpl';
import DeletePaymentMethodImpl from '../endpoints/DeletePaymentMethodImpl';
import GetPaymentsImpl from '../endpoints/GetPaymentsImpl';
import GetInvoicesImpl from '../endpoints/GetInvoicesImpl';
import PutBillingSettingsImpl from '../endpoints/PutBillingSettingsImpl';

import GetSubAccountsImpl from '../endpoints/GetSubAccountsImpl';
import PostSubAccountImpl from '../endpoints/PostSubAccountImpl';
import PostSubAccountStatusImpl from '../endpoints/PostSubAccountStatusImpl';
import PostOwnerTransferImpl from '../endpoints/PostOwnerTransferImpl';

//
// READ role — the account service's local API surface (the dev webproxy routes ALL /api/acct here, per
// LOCAL_API_ROLE = { account: "read" }). Reads (get account, memberships) plus the account edit (PutAccount,
// admin-only — access is enforced by the authorize gate). In a prod reader/writer split the write would
// move to a writer role; locally everything is served from this one process.
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
        this.register( new PutAccountImpl( this ) );
        this.register( new GetMembershipsImpl( this ) );
        // account users (members) + invitations
        this.register( new GetMembersImpl( this ) );
        this.register( new PatchMemberImpl( this ) );
        this.register( new DeleteMemberImpl( this ) );
        this.register( new GetInvitesImpl( this ) );
        this.register( new PostInviteImpl( this ) );
        this.register( new PostInviteResendImpl( this ) );
        this.register( new DeleteInviteImpl( this ) );
        // billing surface (skeleton — Stripe/plans not wired)
        this.register( new GetBillingImpl( this ) );
        this.register( new PostBalanceTopupImpl( this ) );
        this.register( new GetPaymentMethodsImpl( this ) );
        this.register( new PostPaymentMethodSetupImpl( this ) );
        this.register( new DeletePaymentMethodImpl( this ) );
        this.register( new GetPaymentsImpl( this ) );
        this.register( new GetInvoicesImpl( this ) );
        this.register( new PutBillingSettingsImpl( this ) );
        // hierarchy (sub-accounts) + ownership transfer
        this.register( new GetSubAccountsImpl( this ) );
        this.register( new PostSubAccountImpl( this ) );
        this.register( new PostSubAccountStatusImpl( this ) );
        this.register( new PostOwnerTransferImpl( this ) );
    }
}

export default AccountReadService;
