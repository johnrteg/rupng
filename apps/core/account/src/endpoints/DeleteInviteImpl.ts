//
import { DeleteInvite, Account } from '@repo/api';
import { NetworkUtils } from '@repo/common';
import { RestfulEndpoint } from '@repo/endpoint';
import { Events } from '@repo/system';
import AccountService from '../services/AccountService';

//
// Cancel an invite — SOFT: sets status `cancelled` (the row is kept for the record) so it shows as
// cancelled rather than vanishing. Admin-only. A cancelled invite no longer materializes into a
// membership; re-inviting the same email creates a fresh invite.
//
export class DeleteInviteImpl extends DeleteInvite
{
    private service : AccountService;
    constructor( service : AccountService ) { super(); this.service = service; }

    ///////////////////////////////////////////////////////////////////////////////////////////
    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        const accountId : string | undefined = auth.accountId;
        const inviteId  : string = this.query?.inviteId ?? "";
        if( !accountId || !inviteId ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "account + inviteId required" } };

        const found = await this.service.dynamo.get<Record<string, string>>( "invites", { accountId, inviteId } );
        if( !found.ok )   return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "invite read failed" } };
        if( !found.data ) return { status: NetworkUtils.Status.OK, data: { removed: true } };   // already gone — idempotent

        const cancelled = await this.service.dynamo.put( "invites", { ...found.data, accountId, inviteId, status: Account.InviteStatus.CANCELLED, cancelledAt: new Date().toISOString() } );
        if( !cancelled.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "invite cancel failed" } };

        void this.service.emit( Events.Object.ACCOUNT_INVITE, Events.Verb.DELETED, "invite", inviteId, accountId, { ...found.data, inviteId, status: Account.InviteStatus.CANCELLED }, auth.userId );
        return { status: NetworkUtils.Status.OK, data: { removed: true } };
    }
}

export default DeleteInviteImpl;
