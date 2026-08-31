//
import type { Type } from "@repo/common";
import { Account } from "@repo/api";

import { AccountClient } from "../clients/AccountClient";
import { ReportGenerator } from "./ReportGenerator";

//
// AccountsReportGenerator — the "accounts" catalog entry's generator (report-9.1). Pulls the caller's direct
// managed sub-accounts from `account`'s internal S2S API and flattens each into a row. `SubAccount.children`
// (the nested tree) is dropped for a flat report row — a sub-account's own row appears once, at whatever
// depth account returned it (this generator doesn't recurse further; account's endpoint already returns the
// requested tier). Window filtering is not applicable — sub-accounts have no time-bounded facet to filter
// on, so `window` only feeds `Submission.window` for audit/reproducibility.
//
export class AccountsReportGenerator implements ReportGenerator
{
    ////////////////////////////////////////////////////////////////////////////////////////////
    public async generate( ctx : ReportGenerator.GenerateContext ) : Promise<Type.Result<ReportGenerator.GenerateResult>>
    {
        const client : AccountClient = new AccountClient();
        const found : Type.Result<Array<Account.SubAccount>> = await client.listSubAccounts( ctx.accountId );
        if( !found.ok ) return { ok: false, error: found.error };

        const columns : Array<string> = [ "id", "name", "status", "ownerId", "createdAt" ];
        const rows : Array<Record<string, unknown>> = found.data.map( ( sub : Account.SubAccount ) : Record<string, unknown> => ( {
            id: sub.id, name: sub.name, status: sub.status, ownerId: sub.ownerId ?? "", createdAt: sub.createdAt,
        } ) );

        return { ok: true, data: { rows, columns } };
    }
}

export default AccountsReportGenerator;
// eof
