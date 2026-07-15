//
import { GetSubAccounts, Account } from '@repo/api';
import { NetworkUtils } from '@repo/common';
import { RestfulEndpoint } from '@repo/endpoint';
import AccountService from '../services/AccountService';

//
// List the acting account's sub-accounts as a TREE (accounts whose parentId chains down from the acting
// account) via the `accounts` table's parentId GSI — each node carries its own `children` so the UI can
// cascade into nested sub-accounts. Summarized for display; ACCOUNT access is enforced by the authorize gate.
//
export class GetSubAccountsImpl extends GetSubAccounts
{
    private service : AccountService;
    constructor( service : AccountService ) { super(); this.service = service; }

    // hard depth cap so a malformed parentId cycle can't recurse forever (well above AccountConfig.maxDepth)
    private static readonly MAX_DEPTH : number = 10;

    ///////////////////////////////////////////////////////////////////////////////////////////
    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        if( !auth.userId )    return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };
        const accountId : string | undefined = auth.accountId;
        if( !accountId )      return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "no acting account (X-Account)" } };

        const subAccounts : Array<Account.SubAccount> = await this.childrenOf( accountId, 0 );

        const reply : GetSubAccounts.Response = { subAccounts };
        return { status: NetworkUtils.Status.OK, data: reply };
    }

    ///////////////////////////////////////////////////////////////////////////////////////////
    // the direct children of `parentId`, each with its own descendants attached (recursive; depth-capped)
    private async childrenOf( parentId : string, depth : number ) : Promise<Array<Account.SubAccount>>
    {
        if( depth >= GetSubAccountsImpl.MAX_DEPTH ) return [];

        const found = await this.service.dynamo.query<Record<string, string>>( "accounts", {
            IndexName:                 "parentId",
            KeyConditionExpression:    "parentId = :p",
            ExpressionAttributeValues: { ":p": parentId },
        } );
        if( !found.ok ) return [];

        const nodes : Array<Account.SubAccount> = [];
        for( const row of found.data )
        {
            const id : string = row.id || row.accountId;
            nodes.push( {
                id:        id,
                name:      row.name || "—",
                status:    ( row.status as Account.Status ) ?? Account.Status.ACTIVE,
                ownerId:   row.ownerId || undefined,
                createdAt: row.createdAt,
                children:  await this.childrenOf( id, depth + 1 ),
            } );
        }
        return nodes;
    }
}

export default GetSubAccountsImpl;
