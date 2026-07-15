//
import { GetInvites, Account, Paging } from '@repo/api';
import { NetworkUtils } from '@repo/common';
import { RestfulEndpoint, Access } from '@repo/endpoint';
import AccountService from '../services/AccountService';

//
// List the acting account's PENDING invites (X-Account → auth.accountId). Admin-only.
//
export class GetInvitesImpl extends GetInvites
{
    private service : AccountService;
    constructor( service : AccountService ) { super(); this.service = service; }

    ///////////////////////////////////////////////////////////////////////////////////////////
    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        const accountId : string | undefined = auth.accountId;
        if( !accountId ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "no acting account (X-Account)" } };

        const found = await this.service.dynamo.query<Record<string, string>>( "invites", {
            KeyConditionExpression:    "accountId = :a",
            ExpressionAttributeValues: { ":a": accountId },
        } );
        if( !found.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "invite read failed" } };

        const invites : Array<Account.Invite> = found.data
            // show everything except accepted (accepted invites are now members — see the members list)
            .filter( ( row ) => ( row.status ?? Account.InviteStatus.PENDING ) !== Account.InviteStatus.ACCEPTED )
            .map( ( row ) => ( {
                inviteId:   row.inviteId,
                email:      row.email as Account.Invite[ "email" ],
                role:       ( row.role as Access.Role ) ?? Access.AccountRole.USER,
                status:     ( row.status as Account.InviteStatus ) ?? Account.InviteStatus.PENDING,
                invitedAt:  row.invitedAt,
                lastSentAt: ( row.lastSentAt as Account.Invite[ "lastSentAt" ] ) || undefined,
                invitedBy:  ( row.invitedBy as Account.Invite[ "invitedBy" ] ) || undefined,
            } ) );

        const reply : GetInvites.Response = Paging.paginate( invites, this.query ?? {} );
        return { status: NetworkUtils.Status.OK, data: reply };
    }
}

export default GetInvitesImpl;
