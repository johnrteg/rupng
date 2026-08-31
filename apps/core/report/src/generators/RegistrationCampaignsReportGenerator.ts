//
import type { Type } from "@repo/common";
import { Registration } from "@repo/api";

import { RegistrationClient } from "../clients/RegistrationClient";
import { ReportGenerator } from "./ReportGenerator";

//
// RegistrationCampaignsReportGenerator — the "registration_campaigns" catalog entry's generator (report-9.1).
// Pulls the account's TCR campaigns from registration's internal S2S API, applies the optional `status`
// filter, and flattens each into a row. Window filtering is NOT applied — the internal listing endpoint has
// no created-in-range filter today; `window` still resolves + stamps `Submission.window` for audit/
// reproducibility.
//
export class RegistrationCampaignsReportGenerator implements ReportGenerator
{
    ////////////////////////////////////////////////////////////////////////////////////////////
    public async generate( ctx : ReportGenerator.GenerateContext ) : Promise<Type.Result<ReportGenerator.GenerateResult>>
    {
        const params : { status? : Registration.CampaignStatus } = ctx.params as { status? : Registration.CampaignStatus };
        const client : RegistrationClient = new RegistrationClient();
        const found : Type.Result<Array<Registration.Campaign>> = await client.listCampaigns( ctx.accountId, { status: params.status } );
        if( !found.ok ) return { ok: false, error: found.error };

        const columns : Array<string> = [ "accountId", "brandId", "campaignId", "usecase", "provider", "status", "phoneNumberCount", "createdAt" ];
        const rows : Array<Record<string, unknown>> = found.data.map( ( campaign : Registration.Campaign ) : Record<string, unknown> => ( {
            accountId: campaign.accountId, brandId: campaign.brandId, campaignId: campaign.campaignId ?? "",
            usecase: campaign.usecase, provider: campaign.provider, status: campaign.status,
            phoneNumberCount: campaign.phoneNumbers.length, createdAt: campaign.createdAt,
        } ) );

        return { ok: true, data: { rows, columns } };
    }
}

export default RegistrationCampaignsReportGenerator;
// eof
