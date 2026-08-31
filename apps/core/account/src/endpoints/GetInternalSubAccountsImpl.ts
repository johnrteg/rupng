//
import { GetInternalSubAccounts, Account, Paging } from '@repo/api';
import { NetworkUtils, type Type } from '@repo/common';
import { RestfulEndpoint } from '@repo/endpoint';
import AccountService from '../services/AccountService';

//
// S2S: list an EXPLICIT account's sub-accounts as a TREE (same shape as GetSubAccountsImpl), paged over the
// direct children. No user session on an S2S call, so the account comes from the query param and there is no
// RBAC check to make (the authorize gate never runs for an INTERNAL/no-access endpoint).
//
export class GetInternalSubAccountsImpl extends GetInternalSubAccounts
{
    private service : AccountService;
    constructor( service : AccountService ) { super(); this.service = service; }

    // hard depth cap so a malformed parentId cycle can't recurse forever (well above AccountConfig.maxDepth)
    private static readonly MAX_DEPTH : number = 10;

    ///////////////////////////////////////////////////////////////////////////////////////////
    public async execute( _auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        const query : GetInternalSubAccounts.Query | undefined = this.query;
        const accountId : string | undefined = query?.accountId;
        if( !accountId ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "accountId is required" } };

        // walk the parentId GSI, building each node's own (depth-capped) descendant tree
        const subAccounts : Array<Account.SubAccount> = await this.childrenOf( accountId, 0 );

        // page the direct children (in-memory) into the standard { records, page } envelope
        const paged : Paging.Result<Account.SubAccount> = Paging.paginate( subAccounts, query ?? { accountId } );
        return { status: NetworkUtils.Status.OK, data: paged };
    }

    ///////////////////////////////////////////////////////////////////////////////////////////
    // the direct children of `parentId`, each with its own descendants attached (recursive; depth-capped)
    private async childrenOf( parentId : string, depth : number ) : Promise<Array<Account.SubAccount>>
    {
        if( depth >= GetInternalSubAccountsImpl.MAX_DEPTH ) return [];

        const found : Type.Result<Array<Record<string, string>>> = await this.service.dynamo.query<Record<string, string>>( "accounts", {
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

export default GetInternalSubAccountsImpl;
// eof
