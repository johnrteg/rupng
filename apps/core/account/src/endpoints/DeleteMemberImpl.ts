//
import { DeleteMember } from '@repo/api';
import { NetworkUtils } from '@repo/common';
import { RestfulEndpoint } from '@repo/endpoint';
import { Events } from '@repo/system';
import AccountService from '../services/AccountService';

//
// Remove a user's access to the acting account (delete the membership row — not the user). The account
// OWNER is protected. Admin-only.
//
export class DeleteMemberImpl extends DeleteMember
{
    private service : AccountService;
    constructor( service : AccountService ) { super(); this.service = service; }

    ///////////////////////////////////////////////////////////////////////////////////////////
    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        const accountId : string | undefined = auth.accountId;
        const userId    : string = this.query?.userId ?? "";
        if( !accountId || !userId ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "account + userId required" } };

        const account = await this.service.dynamo.get<{ ownerId? : string }>( "accounts", { accountId } );
        if( account.ok && account.data?.ownerId === userId )
            return { status: NetworkUtils.Status.FORBIDDEN, data: { message: "the account owner can't be removed" } };

        const removed = await this.service.dynamo.remove( "members", { accountId, userId } );
        if( !removed.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "member remove failed" } };

        void this.service.emit( Events.Object.ACCOUNT_MEMBER, Events.Verb.DELETED, "member", userId, accountId, { userId }, auth.userId );
        return { status: NetworkUtils.Status.OK, data: { removed: true } };
    }
}

export default DeleteMemberImpl;
