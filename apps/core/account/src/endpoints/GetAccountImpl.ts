//
import { GetAccount, Account } from '@repo/api';
import { NetworkUtils, ObjectUtils, type Type } from '@repo/common';
import { RestfulEndpoint } from '@repo/endpoint';
import AccountService from '../services/AccountService';

//
// Fetch the caller's ACTING account (the `X-Account` header → auth.accountId), read from the `accounts`
// table (PK `accountId`), composed as the shared Account.Entity. The row is written with an extra
// `accountId` key attribute alongside the entity (see AccountMainService.provisionAccount) — we strip it
// so the response is a clean Entity.
//
export class GetAccountImpl extends GetAccount
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

        const accountId : string | undefined = auth.accountId;
        if( !accountId ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "no acting account (X-Account)" } };

        const found : Type.Result<( Account.Entity & { accountId? : string } ) | undefined> =
            await this.service.dynamo.get<Account.Entity & { accountId? : string }>( "accounts", { accountId } );
        if( !found.ok )   return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "account read failed" } };
        if( !found.data ) return { status: NetworkUtils.Status.NOT_FOUND, data: { message: "account not found" } };

        // fill any fields an older row is missing from the model DEFAULT (identity fields aren't defaulted)
        const filled : Account.Entity & { accountId? : string } = ObjectUtils.withDefaults( found.data, Account.DEFAULT );

        const { accountId: _key, ...entity } = filled;   // drop the table key attribute
        // the partition key is the authoritative id — ensure `id` is set even for rows written without it
        const reply : GetAccount.Response = { ...entity, id: entity.id ?? accountId } as GetAccount.Response;
        return { status: NetworkUtils.Status.OK, data: reply };
    }
}

export default GetAccountImpl;
