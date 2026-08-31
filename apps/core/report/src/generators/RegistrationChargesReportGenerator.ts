//
import { CurrencyUtils, type Type } from "@repo/common";
import { Registration } from "@repo/api";

import { RegistrationClient } from "../clients/RegistrationClient";
import { ReportGenerator } from "./ReportGenerator";

//
// RegistrationChargesReportGenerator — the "registration_cost_estimates" catalog entry's generator
// (report-9.1). Pulls the account's cost-ESTIMATE ledger rows from registration's internal S2S API and
// flattens each into a row. IMPORTANT: `Registration.CostEstimate` is a stub ledger (no billing engine
// exists yet anywhere in the platform) — every row here is "what WOULD be billed" at a legacy TCR charge
// point, never an actual settled charge. `window` (resolved `estimatedStart`/`estimatedEnd`) narrows the
// pulled rows directly, since the internal endpoint DOES support a date-range filter on `estimatedAt`.
//
export class RegistrationChargesReportGenerator implements ReportGenerator
{
    ////////////////////////////////////////////////////////////////////////////////////////////
    public async generate( ctx : ReportGenerator.GenerateContext ) : Promise<Type.Result<ReportGenerator.GenerateResult>>
    {
        const client : RegistrationClient = new RegistrationClient();
        const found : Type.Result<Array<Registration.CostEstimate>> = await client.listCostEstimates( ctx.accountId, {
            estimatedStart: ctx.window?.start, estimatedEnd: ctx.window?.end,
        } );
        if( !found.ok ) return { ok: false, error: found.error };

        const columns : Array<string> = [ "accountId", "kind", "brandId", "campaignId", "amount", "estimatedAt" ];
        const rows : Array<Record<string, unknown>> = found.data.map( ( estimate : Registration.CostEstimate ) : Record<string, unknown> => ( {
            accountId: estimate.accountId, kind: estimate.kind,
            brandId: estimate.brandId ?? "", campaignId: estimate.campaignId ?? "",
            // formatted as "<major-units> <CURRENCY>" — an ESTIMATE, not an actual charge (see header comment)
            amount: `${ CurrencyUtils.centsToDollars( estimate.amount.amountMinor ).toFixed( 2 ) } ${ estimate.amount.currency }`,
            estimatedAt: estimate.estimatedAt,
        } ) );

        return { ok: true, data: { rows, columns } };
    }
}

export default RegistrationChargesReportGenerator;
// eof
