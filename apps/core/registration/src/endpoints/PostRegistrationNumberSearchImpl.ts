//
import { PostRegistrationNumberSearch } from "@repo/api";
import { NetworkUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";

import RegistrationService from "../services/RegistrationService";
import type { AvailableNumber } from "../providers/CarrierProvider";

//
// Search a carrier's available-number inventory (registration-4.x) — the caller picks WHICH configured
// carrier to search (registration has no service-wide default provider; `Campaign.provider` is per-campaign).
//
export class PostRegistrationNumberSearchImpl extends PostRegistrationNumberSearch
{
    private service : RegistrationService;
    constructor( service : RegistrationService ) { super(); this.service = service; }

    ////////////////////////////////////////////////////////////////////////////////////////////
    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        if( !auth.userId || !auth.accountId ) return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };

        const body : PostRegistrationNumberSearch.Body | null = this.body;
        if( !body ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "search criteria is required" } };

        const results : Type.Result<Array<AvailableNumber>> = await this.service.domain.searchNumbers(
            body.numberType, body.carrier, { areaCode: body.areaCode, contains: body.contains, limit: body.limit } );
        if( !results.ok ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: results.error } };

        return { status: NetworkUtils.Status.OK, data: { results: results.data.map( ( row : AvailableNumber ) => ( { number: row.number, numberType: row.type, monthlyPriceCents: row.monthlyPriceCents } ) ) } };
    }
}

export default PostRegistrationNumberSearchImpl;
// eof
