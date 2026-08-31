//
import type { Type } from "@repo/common";
import { Registration } from "@repo/api";

import { RegistrationClient } from "../clients/RegistrationClient";
import { ReportGenerator } from "./ReportGenerator";

//
// RegistrationOpsQueueReportGenerator — the "registration_ops_queue" catalog entry's generator (report-9.1).
// STAFF ONLY (see RegistrationOpsQueueReport's header comment re: `minAccess` limitations) — the real
// staff-only gate belongs at the endpoint/authorization layer, not this generator; this generator only
// builds the rows once a caller has already been let through. Pulls the account's brands + campaigns from
// registration's internal S2S API, keeps only the ones sitting in a non-terminal "needs attention" status,
// and computes time-in-status from each row's `statusHistory` (the time since the most recent transition
// INTO its current status) so staff can triage the oldest-stuck rows first.
//
const BRAND_NEEDS_ATTENTION : ReadonlyArray<Registration.BrandStatus> = [
    Registration.BrandStatus.IN_REVIEW, Registration.BrandStatus.NEEDS_APPEAL, Registration.BrandStatus.FAILED,
];
const CAMPAIGN_NEEDS_ATTENTION : ReadonlyArray<Registration.CampaignStatus> = [
    Registration.CampaignStatus.IN_REVIEW, Registration.CampaignStatus.REJECTED,
];

export class RegistrationOpsQueueReportGenerator implements ReportGenerator
{
    ////////////////////////////////////////////////////////////////////////////////////////////
    public async generate( ctx : ReportGenerator.GenerateContext ) : Promise<Type.Result<ReportGenerator.GenerateResult>>
    {
        const client : RegistrationClient = new RegistrationClient();
        const brandsFound : Type.Result<Array<Registration.Brand>> = await client.listBrands( ctx.accountId );
        if( !brandsFound.ok ) return { ok: false, error: brandsFound.error };
        const campaignsFound : Type.Result<Array<Registration.Campaign>> = await client.listCampaigns( ctx.accountId );
        if( !campaignsFound.ok ) return { ok: false, error: campaignsFound.error };

        const now : number = Date.now();
        const columns : Array<string> = [ "accountId", "kind", "id", "brandId", "status", "reason", "statusSince", "daysInStatus" ];
        const rows : Array<Record<string, unknown>> = [];

        // brands stuck in a needs-attention status — reuse the brand's own StatusHistoryEntry to find when
        // it entered its CURRENT status (the most recent history entry matching it)
        brandsFound.data
            .filter( ( brand : Registration.Brand ) : boolean => BRAND_NEEDS_ATTENTION.includes( brand.status ) )
            .forEach( ( brand : Registration.Brand ) : void =>
            {
                rows.push( statusRow( "brand", brand.brandId ?? "", brand.brandId ?? "", brand.status, brand.statusHistory, brand.rejectionReason, now, ctx.accountId ) );
            } );

        // campaigns stuck in a needs-attention status — same shape, `brandId` carries the parent brand
        campaignsFound.data
            .filter( ( campaign : Registration.Campaign ) : boolean => CAMPAIGN_NEEDS_ATTENTION.includes( campaign.status ) )
            .forEach( ( campaign : Registration.Campaign ) : void =>
            {
                rows.push( statusRow( "campaign", campaign.campaignId ?? "", campaign.brandId, campaign.status, campaign.statusHistory, campaign.rejectionReason, now, ctx.accountId ) );
            } );

        // oldest stuck row first — the point of an ops queue is to surface what's waited longest
        rows.sort( ( first : Record<string, unknown>, second : Record<string, unknown> ) : number => ( second.daysInStatus as number ) - ( first.daysInStatus as number ) );

        return { ok: true, data: { rows, columns } };
    }
}

/** Build one flattened ops-queue row (shared shape for a brand or a campaign) — finds the most recent
 *  `statusHistory` entry matching the row's current status to derive `statusSince`/`daysInStatus`. */
function statusRow(
    kind : "brand" | "campaign", id : string, brandId : string, status : string,
    statusHistory : Array<Registration.StatusHistoryEntry<string>>, reason : string | undefined, now : number, accountId : Type.ID,
) : Record<string, unknown>
{
    const enteredStatusAt : Registration.StatusHistoryEntry<string> | undefined = [ ...statusHistory ]
        .reverse()
        .find( ( entry : Registration.StatusHistoryEntry<string> ) : boolean => entry.status === status );
    const statusSince : string = enteredStatusAt?.time ?? "";
    const daysInStatus : number = statusSince ? Math.floor( ( now - new Date( statusSince ).getTime() ) / ( 24 * 60 * 60 * 1000 ) ) : 0;

    return { accountId, kind, id, brandId, status, reason: reason ?? enteredStatusAt?.reason ?? "", statusSince, daysInStatus };
}

export default RegistrationOpsQueueReportGenerator;
// eof
