//
import { GetRegistrationNumbers, PhoneNumber, Paging } from "@repo/api";
import { NetworkUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";

import RegistrationService from "../services/RegistrationService";

//
// List the caller's account's owned numbers (paged), optionally filtered by type/status.
//
export class GetRegistrationNumbersImpl extends GetRegistrationNumbers
{
    private service : RegistrationService;
    constructor( service : RegistrationService ) { super(); this.service = service; }

    ////////////////////////////////////////////////////////////////////////////////////////////
    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        if( !auth.userId || !auth.accountId ) return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };
        const query : GetRegistrationNumbers.Query = this.query ?? {};

        const found : Type.Result<Array<PhoneNumber.PhoneNumber>> = await this.service.domain.listNumbers( auth.accountId );
        if( !found.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "could not list numbers" } };

        const numbers : Array<PhoneNumber.PhoneNumber> = found.data
            .filter( ( number : PhoneNumber.PhoneNumber ) : boolean => !query.numberType || number.numberType === query.numberType )
            .filter( ( number : PhoneNumber.PhoneNumber ) : boolean => !query.status || number.status === query.status )
            .sort( ( first : PhoneNumber.PhoneNumber, second : PhoneNumber.PhoneNumber ) : number => second.orderedAt.localeCompare( first.orderedAt ) );

        const paged : Paging.Result<PhoneNumber.PhoneNumber> = Paging.paginate( numbers, query );
        return { status: NetworkUtils.Status.OK, data: paged };
    }
}

export default GetRegistrationNumbersImpl;
// eof
