//
import { PostOwnerTransfer, Account } from '@repo/api';
import { NetworkUtils, ObjectUtils } from '@repo/common';
import { RestfulEndpoint, Access } from '@repo/endpoint';
import { Events } from '@repo/system';
import AccountService from '../services/AccountService';

//
// Transfer ownership of the acting account to another existing member. Any ACCOUNT admin may do this (the
// authorize gate enforces the role) — the outgoing owner needn't be present, which is the whole point (they
// left the company). The target must already be a member; they're promoted to ACCOUNT (admin) if needed, and
// the account's ownerId is repointed. Idempotent if the target is already the owner.
//
export class PostOwnerTransferImpl extends PostOwnerTransfer
{
    private service : AccountService;
    constructor( service : AccountService ) { super(); this.service = service; }

    ///////////////////////////////////////////////////////////////////////////////////////////
    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        if( !auth.userId )   return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };
        const accountId : string | undefined = auth.accountId;
        if( !accountId )     return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "no acting account (X-Account)" } };

        const newOwnerId : string = ( this.body?.userId ?? "" ).trim();
        if( newOwnerId === "" ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "a target userId is required" } };

        // the new owner must already be a member of this account
        const member = await this.service.dynamo.get<Record<string, string>>( "members", { accountId, userId: newOwnerId } );
        if( !member.ok )   return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "member read failed" } };
        if( !member.data ) return { status: NetworkUtils.Status.NOT_FOUND, data: { message: "that user is not a member of this account" } };

        const account = await this.service.dynamo.get<( Account.Entity & { accountId? : string } )>( "accounts", { accountId } );
        if( !account.ok )   return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "account read failed" } };
        if( !account.data ) return { status: NetworkUtils.Status.NOT_FOUND, data: { message: "account not found" } };

        // repoint ownership + bump modifiedAt; backfill any missing fields from the model DEFAULT so the row
        // we write back is complete (self-healing) without fabricating identity fields
        const merged : Record<string, unknown> = { ...ObjectUtils.withDefaults( account.data, Account.DEFAULT ), accountId, ownerId: newOwnerId, modifiedAt: new Date().toISOString() };
        const put = await this.service.dynamo.put( "accounts", merged );
        if( !put.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "ownership write failed" } };

        // ensure the new owner is an admin (the owner is always an admin); promote if they were lower
        if( ( member.data.role as Access.Role ) !== Access.AccountRole.ACCOUNT )
            await this.service.dynamo.put( "members", { ...member.data, accountId, userId: newOwnerId, role: Access.AccountRole.ACCOUNT, status: ( member.data.status as Account.MemberStatus ) ?? Account.MemberStatus.ACTIVE } );

        void this.service.emit( Events.Object.ACCOUNT_ACCOUNT, Events.Verb.UPDATED, "account", accountId, accountId, merged, auth.userId );
        return { status: NetworkUtils.Status.OK, data: { ownerId: newOwnerId } };
    }
}

export default PostOwnerTransferImpl;
