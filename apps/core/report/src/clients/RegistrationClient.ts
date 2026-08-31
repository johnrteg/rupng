//
import { NetworkUtils, ResultUtils, type Type } from "@repo/common";
import { RestfulService } from "@repo/endpoint";
import { Ports } from "@repo/services";
import { GetInternalRegistrationBrands, GetInternalRegistrationCampaigns, GetInternalRegistrationCostEstimates, Registration, Paging } from "@repo/api";

//
// RegistrationClient — the S2S client to registration's internal listing APIs (brands/campaigns/cost
// estimates). Base URL is `REGISTRATION_INTERNAL_URL`, falling back to registration's local-dev port — same
// pattern as `ContactClient`/`CampaignClient`. Paginates internally per method — a generator gets the FULL
// account list in one call rather than juggling paging tokens itself.
//
export class RegistrationClient
{
    private readonly client : RestfulService;

    ////////////////////////////////////////////////////////////////////////////////////////////
    constructor()
    {
        this.client = new RestfulService(
            process.env.REGISTRATION_INTERNAL_URL ?? NetworkUtils.url( NetworkUtils.Protocol.HTTP, "localhost", Ports.REGISTRATION.MAIN, null, null ) );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** All of an account's brands (optionally filtered by status), walking every page. */
    public async listBrands( accountId : Type.ID, filters? : RegistrationClient.BrandFilters ) : Promise<Type.Result<Array<Registration.Brand>>>
    {
        const all : Array<Registration.Brand> = [];
        let start : string | undefined = undefined;

        // walk pages until the server stops handing back a `next` token
        for( ;; )
        {
            const reply : RestfulService.Reply<GetInternalRegistrationBrands.Response> = await this.client.fetch(
                new GetInternalRegistrationBrands( { accountId, status: filters?.status, start, count: Paging.MAX_COUNT } ) );
            if( !reply.ok ) return ResultUtils.err( `registration internal brand list failed (${ reply.status })` );

            const page : GetInternalRegistrationBrands.Response = reply.data as GetInternalRegistrationBrands.Response;
            all.push( ...page.records );
            if( page.page.next === undefined ) break;
            start = page.page.next;
        }
        return ResultUtils.ok( all );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** All of an account's campaigns (optionally filtered by brandId/status), walking every page. */
    public async listCampaigns( accountId : Type.ID, filters? : RegistrationClient.CampaignFilters ) : Promise<Type.Result<Array<Registration.Campaign>>>
    {
        const all : Array<Registration.Campaign> = [];
        let start : string | undefined = undefined;

        for( ;; )
        {
            const reply : RestfulService.Reply<GetInternalRegistrationCampaigns.Response> = await this.client.fetch(
                new GetInternalRegistrationCampaigns( { accountId, brandId: filters?.brandId, status: filters?.status, start, count: Paging.MAX_COUNT } ) );
            if( !reply.ok ) return ResultUtils.err( `registration internal campaign list failed (${ reply.status })` );

            const page : GetInternalRegistrationCampaigns.Response = reply.data as GetInternalRegistrationCampaigns.Response;
            all.push( ...page.records );
            if( page.page.next === undefined ) break;
            start = page.page.next;
        }
        return ResultUtils.ok( all );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** All of an account's cost-estimate ledger rows (optionally filtered by kind/estimated-date-range),
     *  walking every page. */
    public async listCostEstimates( accountId : Type.ID, filters? : RegistrationClient.CostEstimateFilters ) : Promise<Type.Result<Array<Registration.CostEstimate>>>
    {
        const all : Array<Registration.CostEstimate> = [];
        let start : string | undefined = undefined;

        for( ;; )
        {
            const reply : RestfulService.Reply<GetInternalRegistrationCostEstimates.Response> = await this.client.fetch(
                new GetInternalRegistrationCostEstimates( {
                    accountId, kind: filters?.kind, estimatedStart: filters?.estimatedStart, estimatedEnd: filters?.estimatedEnd,
                    start, count: Paging.MAX_COUNT,
                } ) );
            if( !reply.ok ) return ResultUtils.err( `registration internal cost-estimate list failed (${ reply.status })` );

            const page : GetInternalRegistrationCostEstimates.Response = reply.data as GetInternalRegistrationCostEstimates.Response;
            all.push( ...page.records );
            if( page.page.next === undefined ) break;
            start = page.page.next;
        }
        return ResultUtils.ok( all );
    }
}

export namespace RegistrationClient
{
    /** The optional matching params `listBrands` forwards through to `GetInternalRegistrationBrands`'s query. */
    export interface BrandFilters
    {
        status? : Registration.BrandStatus;
    }

    /** The optional matching params `listCampaigns` forwards through to `GetInternalRegistrationCampaigns`'s query. */
    export interface CampaignFilters
    {
        brandId? : string;
        status?  : Registration.CampaignStatus;
    }

    /** The optional matching params `listCostEstimates` forwards through to
     *  `GetInternalRegistrationCostEstimates`'s query. */
    export interface CostEstimateFilters
    {
        kind?           : Registration.CostEstimateKind;
        estimatedStart? : Type.ISODateTime;
        estimatedEnd?   : Type.ISODateTime;
    }
}

export default RegistrationClient;
// eof
