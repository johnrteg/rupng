//
import type { Type } from "@repo/common";
import { Campaign } from "@repo/api";

import { CampaignClient } from "../clients/CampaignClient";
import { ReportGenerator } from "./ReportGenerator";

//
// CampaignsReportGenerator — the "campaigns" catalog entry's generator (report-9.1). Pulls the account's
// campaigns from `campaign`'s internal S2S API, applies the optional `status` filter, and flattens each
// into a row. Window filtering is NOT applied — `GetInternalCampaigns` has no created/modified-in-range
// filter today; `window` still resolves + stamps `Submission.window` for audit/reproducibility.
//
export class CampaignsReportGenerator implements ReportGenerator
{
    ////////////////////////////////////////////////////////////////////////////////////////////
    public async generate( ctx : ReportGenerator.GenerateContext ) : Promise<Type.Result<ReportGenerator.GenerateResult>>
    {
        const params : { status? : Campaign.Status } = ctx.params as { status? : Campaign.Status };
        const client : CampaignClient = new CampaignClient();
        const found : Type.Result<Array<Campaign.Entity>> = await client.listCampaigns( ctx.accountId, params.status );
        if( !found.ok ) return { ok: false, error: found.error };

        const columns : Array<string> = [ "id", "ref", "name", "status", "objective", "createdAt", "modifiedAt" ];
        const rows : Array<Record<string, unknown>> = found.data.map( ( campaign : Campaign.Entity ) : Record<string, unknown> => ( {
            id: campaign.id, ref: campaign.ref, name: campaign.name, status: campaign.status,
            objective: campaign.objective ?? "", createdAt: campaign.createdAt, modifiedAt: campaign.modifiedAt,
        } ) );

        return { ok: true, data: { rows, columns } };
    }
}

export default CampaignsReportGenerator;
// eof
