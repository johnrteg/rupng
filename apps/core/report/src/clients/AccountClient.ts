//
import { NetworkUtils, ResultUtils, type Type } from "@repo/common";
import { RestfulService } from "@repo/endpoint";
import { Ports } from "@repo/services";
import { GetInternalSubAccounts, Account, Paging } from "@repo/api";

//
// AccountClient — the S2S client to account's internal sub-account listing API. Base URL is
// `ACCOUNT_INTERNAL_URL`, falling back to account's local-dev port — same pattern as `MediaClient`.
// Paginates internally, accumulating every direct sub-account across pages.
//
export class AccountClient
{
    private readonly client : RestfulService;

    ////////////////////////////////////////////////////////////////////////////////////////////
    constructor()
    {
        this.client = new RestfulService(
            process.env.ACCOUNT_INTERNAL_URL ?? NetworkUtils.url( NetworkUtils.Protocol.HTTP, "localhost", Ports.ACCOUNT.MAIN, null, null ) );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** All of an account's direct sub-accounts, walking every page. */
    public async listSubAccounts( accountId : Type.ID ) : Promise<Type.Result<Array<Account.SubAccount>>>
    {
        const all : Array<Account.SubAccount> = [];
        let start : string | undefined = undefined;

        for( ;; )
        {
            const reply : RestfulService.Reply<GetInternalSubAccounts.Response> = await this.client.fetch(
                new GetInternalSubAccounts( { accountId, start, count: Paging.MAX_COUNT } ) );
            if( !reply.ok ) return ResultUtils.err( `account internal sub-accounts failed (${ reply.status })` );

            const page : GetInternalSubAccounts.Response = reply.data as GetInternalSubAccounts.Response;
            all.push( ...page.records );
            if( page.page.next === undefined ) break;
            start = page.page.next;
        }
        return ResultUtils.ok( all );
    }
}

export default AccountClient;
// eof
