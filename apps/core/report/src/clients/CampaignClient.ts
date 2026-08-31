//
import { NetworkUtils, ResultUtils, type Type } from "@repo/common";
import { RestfulService } from "@repo/endpoint";
import { Ports } from "@repo/services";
import { GetInternalCampaigns, Campaign, Paging } from "@repo/api";

//
// CampaignClient — the S2S client to campaign's internal listing API. Base URL is `CAMPAIGN_INTERNAL_URL`,
// falling back to campaign's local-dev port — same pattern as `MediaClient`. Paginates internally.
//
export class CampaignClient
{
    private readonly client : RestfulService;

    ////////////////////////////////////////////////////////////////////////////////////////////
    constructor()
    {
        this.client = new RestfulService(
            process.env.CAMPAIGN_INTERNAL_URL ?? NetworkUtils.url( NetworkUtils.Protocol.HTTP, "localhost", Ports.CAMPAIGN.MAIN, null, null ) );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** All of an account's campaigns (optionally filtered by status), walking every page. */
    public async listCampaigns( accountId : Type.ID, status? : Campaign.Status ) : Promise<Type.Result<Array<Campaign.Entity>>>
    {
        const all : Array<Campaign.Entity> = [];
        let start : string | undefined = undefined;

        for( ;; )
        {
            const reply : RestfulService.Reply<GetInternalCampaigns.Response> = await this.client.fetch(
                new GetInternalCampaigns( { accountId, status, start, count: Paging.MAX_COUNT } ) );
            if( !reply.ok ) return ResultUtils.err( `campaign internal list failed (${ reply.status })` );

            const page : GetInternalCampaigns.Response = reply.data as GetInternalCampaigns.Response;
            all.push( ...page.records );
            if( page.page.next === undefined ) break;
            start = page.page.next;
        }
        return ResultUtils.ok( all );
    }
}

export default CampaignClient;
// eof
