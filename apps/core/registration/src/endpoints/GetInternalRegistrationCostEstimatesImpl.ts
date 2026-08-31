//
import { GetInternalRegistrationCostEstimates, Registration, Paging } from "@repo/api";
import { NetworkUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";

import RegistrationService from "../services/RegistrationService";

//
// S2S: list cost-estimate ledger rows in a date range, optionally filtered by accountId/kind. INTERNAL
// audience. Backs the `registration_cost_estimates` report — and these are ESTIMATES, not charges: no billing
// engine exists in this platform yet, so a report renders this as "what would be billed".
//
export class GetInternalRegistrationCostEstimatesImpl extends GetInternalRegistrationCostEstimates
{
    private service : RegistrationService;
    constructor( service : RegistrationService ) { super(); this.service = service; }

    ////////////////////////////////////////////////////////////////////////////////////////////
    public async execute( _auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        const query : GetInternalRegistrationCostEstimates.Query = this.query ?? {};

        const found : Type.Result<Array<Registration.CostEstimate>> = query.accountId
            ? await this.service.domain.listCostEstimates( query.accountId )
            : await this.service.domain.scanCostEstimates();
        if( !found.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "cost estimates read failed" } };

        // filter by kind + the estimatedAt range (ISO-8601 strings sort lexicographically, so a string
        // comparison IS a chronological one here — the same convention contact's report filters use)
        const estimates : Array<Registration.CostEstimate> = found.data
            .filter( ( row : Registration.CostEstimate ) : boolean => !query.kind || row.kind === query.kind )
            .filter( ( row : Registration.CostEstimate ) : boolean => !query.estimatedStart || row.estimatedAt >= query.estimatedStart )
            .filter( ( row : Registration.CostEstimate ) : boolean => !query.estimatedEnd || row.estimatedAt <= query.estimatedEnd )
            .sort( ( first : Registration.CostEstimate, second : Registration.CostEstimate ) : number => second.estimatedAt.localeCompare( first.estimatedAt ) );

        const paged : Paging.Result<Registration.CostEstimate> = Paging.paginate( estimates, query );
        return { status: NetworkUtils.Status.OK, data: paged };
    }
}

export default GetInternalRegistrationCostEstimatesImpl;
// eof
