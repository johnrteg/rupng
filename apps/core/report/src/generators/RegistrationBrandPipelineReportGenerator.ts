//
import type { Type } from "@repo/common";
import { Registration } from "@repo/api";

import { RegistrationClient } from "../clients/RegistrationClient";
import { ReportGenerator } from "./ReportGenerator";

//
// RegistrationBrandPipelineReportGenerator — the "registration_brand_pipeline" catalog entry's generator
// (report-9.1). Pulls the account's full brand list AND full campaign list from `registration`'s internal
// S2S API, rolls the campaigns up into a per-brand campaign-count-by-status map, and flattens each brand
// (+ its rollup) into a row. Window filtering is NOT applied — the internal listing endpoints have no
// created/modified-in-range filter today; `window` still resolves + stamps `Submission.window` for
// audit/reproducibility.
//
export class RegistrationBrandPipelineReportGenerator implements ReportGenerator
{
    ////////////////////////////////////////////////////////////////////////////////////////////
    public async generate( ctx : ReportGenerator.GenerateContext ) : Promise<Type.Result<ReportGenerator.GenerateResult>>
    {
        const client : RegistrationClient = new RegistrationClient();

        // pull both brands and campaigns for the account so the campaign-count-by-status rollup can be
        // computed here, in the generator, rather than asking registration for a pre-aggregated view
        const brandsFound : Type.Result<Array<Registration.Brand>> = await client.listBrands( ctx.accountId );
        if( !brandsFound.ok ) return { ok: false, error: brandsFound.error };
        const campaignsFound : Type.Result<Array<Registration.Campaign>> = await client.listCampaigns( ctx.accountId );
        if( !campaignsFound.ok ) return { ok: false, error: campaignsFound.error };

        // group campaign counts per brandId, keyed by campaign status, for the "campaigns by status" columns
        const countsByBrand : Map<string, Partial<Record<Registration.CampaignStatus, number>>> = new Map<string, Partial<Record<Registration.CampaignStatus, number>>>();
        campaignsFound.data.forEach( ( campaign : Registration.Campaign ) : void =>
        {
            const counts : Partial<Record<Registration.CampaignStatus, number>> = countsByBrand.get( campaign.brandId ) ?? {};
            counts[ campaign.status ] = ( counts[ campaign.status ] ?? 0 ) + 1;
            countsByBrand.set( campaign.brandId, counts );
        } );

        const statusColumns : Array<string> = Object.values( Registration.CampaignStatus ).map( ( status : Registration.CampaignStatus ) : string => `campaigns_${ status }` );
        const columns : Array<string> = [
            "accountId", "brandId", "tcrBrandId", "entityType", "status", "vettingProvider", "vettingScore",
            "campaignCount", ...statusColumns, "createdAt", "updatedAt",
        ];

        const rows : Array<Record<string, unknown>> = brandsFound.data.map( ( brand : Registration.Brand ) : Record<string, unknown> =>
        {
            const counts : Partial<Record<Registration.CampaignStatus, number>> = countsByBrand.get( brand.brandId ?? "" ) ?? {};
            const statusCells : Record<string, unknown> = {};
            Object.values( Registration.CampaignStatus ).forEach( ( status : Registration.CampaignStatus ) : void =>
            {
                statusCells[ `campaigns_${ status }` ] = counts[ status ] ?? 0;
            } );

            return {
                accountId: brand.accountId, brandId: brand.brandId ?? "", tcrBrandId: brand.tcrBrandId ?? "",
                entityType: brand.entityType, status: brand.status,
                vettingProvider: brand.vettingProvider ?? "", vettingScore: brand.vettingScore ?? "",
                campaignCount: Object.values( counts ).reduce( ( total : number, count : number ) : number => total + count, 0 ),
                ...statusCells,
                createdAt: brand.createdAt, updatedAt: brand.updatedAt,
            };
        } );

        return { ok: true, data: { rows, columns } };
    }
}

export default RegistrationBrandPipelineReportGenerator;
// eof
