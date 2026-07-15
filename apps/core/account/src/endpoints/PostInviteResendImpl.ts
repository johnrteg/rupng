//
import { PostInviteResend, Account } from '@repo/api';
import { NetworkUtils } from '@repo/common';
import { RestfulEndpoint, Access } from '@repo/endpoint';
import { Events } from '@repo/system';
import AccountService from '../services/AccountService';

//
// Re-send a pending invite's (stub) email; bumps `lastSentAt`, preserves `invitedAt` (so the age is
// unchanged). Admin-only.
//
export class PostInviteResendImpl extends PostInviteResend
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
        const active : ReadonlyArray<string> = [ Account.InviteStatus.PENDING, Account.InviteStatus.INVITED ];
        if( !found.data || !active.includes( found.data.status ?? Account.InviteStatus.PENDING ) )
            return { status: NetworkUtils.Status.NOT_FOUND, data: { message: "no active invite to resend" } };

        // re-sending the (stub) email → status INVITED, bump lastSentAt, keep the original invitedAt (age)
        const now : string = new Date().toISOString();
        const put = await this.service.dynamo.put( "invites", { ...found.data, accountId, inviteId, status: Account.InviteStatus.INVITED, lastSentAt: now } );
        if( !put.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "invite write failed" } };

        this.service.log.info( "invite.email.stub", { accountId, email: found.data.email, inviteId, resent: true } );

        const invite : Account.Invite = {
            inviteId,
            email:      found.data.email as Account.Invite[ "email" ],
            role:       ( found.data.role as Access.Role ),
            status:     Account.InviteStatus.INVITED,
            invitedAt:  found.data.invitedAt,
            lastSentAt: now,
            invitedBy:  ( found.data.invitedBy as Account.Invite[ "invitedBy" ] ) || undefined,
        };
        void this.service.emit( Events.Object.ACCOUNT_INVITE, Events.Verb.UPDATED, "invite", inviteId, accountId, invite, auth.userId );
        return { status: NetworkUtils.Status.OK, data: { invite } };
    }
}

export default PostInviteResendImpl;
