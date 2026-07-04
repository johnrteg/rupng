//
import { PatchMember, Account } from '@repo/api';
import { NetworkUtils } from '@repo/common';
import { RestfulEndpoint, Access } from '@repo/endpoint';
import { Events } from '@repo/system';
import AccountService from '../services/AccountService';

//
// Change a member's role and/or status (suspend / reactivate) in the acting account. The account OWNER is
// protected (can't be re-roled or suspended). Admin-only (enforced by the authorize gate).
//
export class PatchMemberImpl extends PatchMember
{
    private service : AccountService;
    constructor( service : AccountService ) { super(); this.service = service; }

    ///////////////////////////////////////////////////////////////////////////////////////////
    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        const accountId : string | undefined = auth.accountId;
        const userId    : string = this.query?.userId ?? "";
        if( !accountId || !userId ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "account + userId required" } };

        const role   : Access.Role | undefined = this.body?.role;
        const status : Account.MemberStatus | undefined = this.body?.status;
        if( role === undefined && status === undefined ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "nothing to update" } };
        if( role !== undefined && !( Access.LADDER as ReadonlyArray<string> ).includes( role ) ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "invalid role" } };

        const found = await this.service.dynamo.get<Record<string, string>>( "members", { accountId, userId } );
        if( !found.ok )   return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "member read failed" } };
        if( !found.data ) return { status: NetworkUtils.Status.NOT_FOUND, data: { message: "not a member" } };

        // protect the account owner
        const account = await this.service.dynamo.get<{ ownerId? : string }>( "accounts", { accountId } );
        if( account.ok && account.data?.ownerId === userId )
            return { status: NetworkUtils.Status.FORBIDDEN, data: { message: "the account owner can't be changed" } };

        const updated : Record<string, unknown> = {
            ...found.data,
            accountId, userId,
            role:   role   ?? found.data.role,
            status: status ?? found.data.status ?? Account.MemberStatus.ACTIVE,
        };
        const put = await this.service.dynamo.put( "members", updated );
        if( !put.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "member write failed" } };

        const member : Account.Member = {
            userId,
            role:        ( updated.role as Access.Role ),
            status:      ( updated.status as Account.MemberStatus ),
            name:        ( found.data.name as string ) || undefined,
            email:       ( found.data.email as Account.Member[ "email" ] ) || undefined,
            owner:       false,
            createdAt:   found.data.createdAt,
            lastLoginAt: ( found.data.lastLoginAt as Account.Member[ "lastLoginAt" ] ) || undefined,
        };
        void this.service.emit( Events.Object.ACCOUNT_MEMBER, Events.Verb.UPDATED, "member", userId, accountId, member, auth.userId );
        return { status: NetworkUtils.Status.OK, data: { member } };
    }
}

export default PatchMemberImpl;
