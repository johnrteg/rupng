//
import { GetMembers, Account, Paging } from '@repo/api';
import { NetworkUtils } from '@repo/common';
import { RestfulEndpoint, Access } from '@repo/endpoint';
import AccountService from '../services/AccountService';

//
// List the members of the caller's ACTING account (X-Account → auth.accountId) — the `members` table
// (PK accountId), enriched with the owner flag from `accounts`. Name/email are denormalized on the row
// (captured on add); lastAccessedAt is best-effort.
//
// Self-heals the CALLER'S OWN row: older rows (pre-denormalization) or ones provisioned without capturing
// identity can lack name/email, so this user would show blank in their own account's list. We stamp their
// row from the JWT claims this request already carries (best-effort write-back — no cross-service call). We
// can only heal the caller's own row here (that's the only identity `auth` gives us); other members' rows
// self-heal when THEY load their memberships (GetMemberships), or were captured on invite acceptance.
//
export class GetMembersImpl extends GetMembers
{
    private service : AccountService;
    constructor( service : AccountService ) { super(); this.service = service; }

    ///////////////////////////////////////////////////////////////////////////////////////////
    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        const accountId : string | undefined = auth.accountId;
        if( !accountId ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "no acting account (X-Account)" } };

        const found = await this.service.dynamo.query<Record<string, string>>( "members", {
            KeyConditionExpression:    "accountId = :a",
            ExpressionAttributeValues: { ":a": accountId },
        } );
        if( !found.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "member read failed" } };

        const rows : Array<Record<string, string>> = found.data;

        // backfill the caller's own row from their JWT claims when identity is missing (self-healing on load)
        const claims     : Record<string, unknown> = auth.claims ?? {};
        const claimEmail : string = String( claims[ "email" ] ?? "" ).trim().toLowerCase();
        const claimName  : string = this.claimName( claims );
        for( const row of rows )
        {
            if( row.userId !== auth.userId ) continue;
            if( ( !row.name && claimName ) || ( !row.email && claimEmail ) )
            {
                row.name  = row.name  || claimName;
                row.email = row.email || claimEmail;
                await this.service.dynamo.put( "members", { ...row } );   // best-effort persist
            }
        }

        const account = await this.service.dynamo.get<{ ownerId? : string }>( "accounts", { accountId } );
        const ownerId : string | undefined = account.ok && account.data ? account.data.ownerId : undefined;

        const members : Array<Account.Member> = rows.map( ( row ) => ( {
            userId:      row.userId,
            role:        ( row.role as Access.Role ) ?? Access.AccountRole.USER,
            status:      ( row.status as Account.MemberStatus ) ?? Account.MemberStatus.ACTIVE,
            name:        row.name || undefined,
            email:       ( row.email as Account.Member[ "email" ] ) || undefined,
            owner:       !!ownerId && row.userId === ownerId,
            createdAt:      row.createdAt,
            lastAccessedAt: ( row.lastAccessedAt as Account.Member[ "lastAccessedAt" ] ) || undefined,
        } ) );

        const reply : GetMembers.Response = Paging.paginate( members, this.query ?? {} );
        return { status: NetworkUtils.Status.OK, data: reply };
    }

    ///////////////////////////////////////////////////////////////////////////////////////////
    // a display name from the JWT claims (name, or given+family), or "" if none
    private claimName( claims : Record<string, unknown> ) : string
    {
        const name : string = String( claims[ "name" ] ?? "" ).trim();
        if( name !== "" ) return name;
        return `${ String( claims[ "given_name" ] ?? "" ) } ${ String( claims[ "family_name" ] ?? "" ) }`.trim();
    }
}

export default GetMembersImpl;
