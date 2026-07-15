//
import { GetMemberships, User, Account } from '@repo/api';
import { NetworkUtils } from '@repo/common';
import { RestfulEndpoint, Access } from '@repo/endpoint';
import AccountService from '../services/AccountService';

//
// List the caller's account memberships (a user belongs to 1..N accounts). Reads the OWNED `members`
// table by userId (GSI), then composes each with its account's name + owner flag (the `accounts` table).
// `owner` marks the caller's own account — the client's reset target if they're removed from their
// last-used one.
//
// Also **materializes pending invites** for the caller's email (best-effort) — this is how an invited user
// (existing or newly-registered) is added to the inviting account: on their next memberships load, any
// pending invite for their email becomes a membership at the invited role. No cross-service call — the
// email comes from the JWT claims this request already carries.
//
export class GetMembershipsImpl extends GetMemberships
{
    private service : AccountService;

    constructor( service : AccountService )
    {
        super();
        this.service = service;
    }

    ///////////////////////////////////////////////////////////////////////////////////////////
    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        if( !auth.userId ) return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };

        const claims    : Record<string, unknown> = auth.claims ?? {};
        const claimName : string = this.claimName( claims );

        // the caller's member rows (their memberships across accounts)
        let membersResult = await this.service.dynamo.query<Record<string, string>>( "members", {
            IndexName:                 "userId",
            KeyConditionExpression:    "userId = :u",
            ExpressionAttributeValues: { ":u": auth.userId },
        } );

        // a RELIABLE email for invite matching + identity backfill. The dev access token has NO `email` claim,
        // so prefer a denormalized email off an existing member row; fall back to the claim (present in prod).
        const claimEmail : string = String( claims[ "email" ] ?? "" ).trim().toLowerCase();
        const email : string = ( ( membersResult.ok ? membersResult.data.find( ( r ) => !!r.email )?.email : undefined ) ?? claimEmail ).trim().toLowerCase();

        // materialize any outstanding invites into memberships (shared logic), then re-read if we joined any
        try
        {
            const joined : number = await this.service.joinPendingInvites( auth.userId, email, claimName );
            if( joined > 0 )
                membersResult = await this.service.dynamo.query<Record<string, string>>( "members", {
                    IndexName:                 "userId",
                    KeyConditionExpression:    "userId = :u",
                    ExpressionAttributeValues: { ":u": auth.userId },
                } );
        }
        catch( err ) { this.service.log.warn( "invite materialize failed (non-fatal)", err ); }

        const nameCache : Map<string, string> = new Map();   // accountId → name (dedupes parent lookups)

        // oldest membership first (ISO timestamps sort chronologically) — so the client lands in the account
        // the user was FIRST invited to when they have no personal/saved account (the default is accounts[0])
        const rows : Array<Record<string, string>> = ( membersResult.ok ? membersResult.data : [] ).slice()
            .sort( ( a : Record<string, string>, b : Record<string, string> ) => String( a.createdAt ?? "" ).localeCompare( String( b.createdAt ?? "" ) ) );

        const memberships : Array<User.Membership> = [];
        for( const member of rows )
        {
            if( ( !member.email && email ) || ( !member.name && claimName ) )
                await this.service.dynamo.put( "members", {
                    ...member,
                    email: member.email || email     || undefined,
                    name:  member.name  || claimName || undefined,
                } );

            const account = await this.service.dynamo.get<{ name : string; ownerId? : string; parentId? : string }>( "accounts", { accountId: member.accountId } );
            const accountName : string = ( account.ok && account.data ) ? account.data.name : member.accountId;
            if( account.ok && account.data ) nameCache.set( member.accountId, accountName );

            // a sub-account carries its immediate parent's name so the switcher can show "Parent / Child"
            const parentId : string | undefined = ( account.ok && account.data ) ? account.data.parentId : undefined;
            const parentName : string | undefined = parentId ? await this.accountName( parentId, nameCache ) : undefined;

            memberships.push( {
                accountId:   member.accountId,
                accountName: accountName,
                parentName:  parentName,
                maxRole:     ( member.role as Access.Role ) ?? Access.AccountRole.USER,
                owner:       ( account.ok && account.data ) ? account.data.ownerId === auth.userId : false,
            } );
        }

        // LAZY FALLBACK — a registered user with NO memberships and NO pending invite would be locked out.
        // This happens when an invited user's invite is CANCELLED after they registered but before their first
        // login: provisionAccount had skipped the personal account (the invite was pending then), and the now-
        // cancelled invite won't materialize. Rather than warn them about an invite they may never have seen
        // (and leak that it existed), silently mint a personal account so they always have somewhere to land.
        // Idempotent in practice: once created, the next load finds the membership and this block is skipped.
        // (`materializeInvites` ran above, so a still-pending invite would already be a membership here — the
        // extra hasPendingInvite guard covers the case where materialization failed.)
        if( memberships.length === 0 && auth.userId && !( await this.service.hasPendingInvite( email ) ) )
        {
            const created : Account.Entity | null = await this.service.provisionPersonalAccount( { userId: auth.userId, email: email || undefined, name: claimName || undefined } );
            if( created )
            {
                this.service.log.info( "lazy-provisioned a personal account for an orphaned user", { userId: auth.userId, accountId: created.id } );
                memberships.push( { accountId: created.id, accountName: created.name, maxRole: Access.AccountRole.ACCOUNT, owner: true } );
            }
        }

        const reply : GetMemberships.Response = { accounts: memberships };
        return { status: NetworkUtils.Status.OK, data: reply };
    }


    ///////////////////////////////////////////////////////////////////////////////////////////
    // an account's display name (cached across this request), or undefined if it can't be read
    private async accountName( accountId : string, cache : Map<string, string> ) : Promise<string | undefined>
    {
        const cached : string | undefined = cache.get( accountId );
        if( cached !== undefined ) return cached;
        const row = await this.service.dynamo.get<{ name : string }>( "accounts", { accountId } );
        if( !row.ok || !row.data ) return undefined;
        cache.set( accountId, row.data.name );
        return row.data.name;
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

export default GetMembershipsImpl;
