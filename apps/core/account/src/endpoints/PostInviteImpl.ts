//
import { randomUUID } from "crypto";

import { PostInvite, Account } from '@repo/api';
import { NetworkUtils } from '@repo/common';
import { RestfulEndpoint, Access } from '@repo/endpoint';
import { Events } from '@repo/system';
import AccountService from '../services/AccountService';

//
// Invite an email to the acting account at a role (admin-only). The DURABLE invite row is written
// SYNCHRONOUSLY so it appears in the pending list immediately (no async race), then only the email
// NOTIFICATION is decoupled to the `invite-requests` SQS queue (the consumer "sends" the stub email + flips
// the invite PENDING → INVITED). Idempotent: 409 if the email is already a member; reuses an existing active
// invite for the same email (re-invite). Materialization into a membership still happens when the invitee
// next authenticates — see GetMemberships / joinPendingInvites.
//
export class PostInviteImpl extends PostInvite
{
    private service : AccountService;
    constructor( service : AccountService ) { super(); this.service = service; }

    ///////////////////////////////////////////////////////////////////////////////////////////
    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        const accountId : string | undefined = auth.accountId;
        if( !accountId ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "no acting account (X-Account)" } };

        const email : string = ( this.body?.email ?? "" ).trim().toLowerCase();
        const role  : Access.Role = this.body?.role as Access.Role;
        if( email === "" ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "email required" } };
        if( !( Access.LADDER as ReadonlyArray<string> ).includes( role ) ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "invalid role" } };

        // already a member of THIS account? then there's nothing to invite
        const members = await this.service.dynamo.query<Record<string, string>>( "members", {
            KeyConditionExpression: "accountId = :a", ExpressionAttributeValues: { ":a": accountId } } );
        if( members.ok && members.data.some( ( row ) => ( row.email ?? "" ).toLowerCase() === email ) )
            return { status: NetworkUtils.Status.CONFLICT, data: { message: "that email is already a member of this account" } };

        // reuse an active invite (pending/invited) for the same email so re-inviting doesn't create duplicates
        const existing = await this.service.dynamo.query<Record<string, string>>( "invites", {
            KeyConditionExpression: "accountId = :a", ExpressionAttributeValues: { ":a": accountId } } );
        const active : ReadonlyArray<string> = [ Account.InviteStatus.PENDING, Account.InviteStatus.INVITED ];
        const prior  = existing.ok
            ? existing.data.find( ( row ) => ( row.email ?? "" ).toLowerCase() === email && active.includes( row.status ?? Account.InviteStatus.PENDING ) )
            : undefined;

        const now : string = new Date().toISOString();
        const invite : Account.Invite = {
            inviteId:   ( prior?.inviteId as Account.Invite[ "inviteId" ] ) ?? randomUUID(),
            email:      email as Account.Invite[ "email" ],
            role,
            status:     ( prior?.status as Account.InviteStatus ) ?? Account.InviteStatus.PENDING,
            invitedAt:  ( prior?.invitedAt as Account.Invite[ "invitedAt" ] ) ?? now,
            lastSentAt: now,
            invitedBy:  auth.userId as Account.Invite[ "invitedBy" ],
        };

        // write the durable row NOW (key alongside the entity) so the pending list reflects it immediately
        const put = await this.service.dynamo.put( "invites", { ...invite, accountId } );
        if( !put.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "could not create the invitation" } };

        // decouple only the notification: the consumer "sends" the (stub) email + flips PENDING → INVITED
        await this.service.sqs.send( "invite-requests", { accountId, inviteId: invite.inviteId, email, role, invitedAt: invite.invitedAt, invitedBy: auth.userId } );
        void this.service.emit( Events.Object.ACCOUNT_INVITE, Events.Verb.CREATED, "invite", invite.inviteId, accountId, invite, auth.userId );

        return { status: NetworkUtils.Status.OK, data: { invite } };
    }
}

export default PostInviteImpl;
