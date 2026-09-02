//
import { GetRegistrationShortCodeApplications, PhoneNumber, Paging } from "@repo/api";
import { NetworkUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";

import RegistrationService from "../services/RegistrationService";

//
// List the caller's account's short-code applications (paged), optionally filtered by status.
//
export class GetRegistrationShortCodeApplicationsImpl extends GetRegistrationShortCodeApplications
{
    private service : RegistrationService;
    constructor( service : RegistrationService ) { super(); this.service = service; }

    ////////////////////////////////////////////////////////////////////////////////////////////
    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        if( !auth.userId || !auth.accountId ) return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };
        const query : GetRegistrationShortCodeApplications.Query = this.query ?? {};

        const found : Type.Result<Array<PhoneNumber.ShortCodeApplication>> = await this.service.domain.listShortCodeApplications( auth.accountId );
        if( !found.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "could not list short-code applications" } };

        const applications : Array<PhoneNumber.ShortCodeApplication> = found.data
            .filter( ( application : PhoneNumber.ShortCodeApplication ) : boolean => !query.status || application.status === query.status )
            .sort( ( first : PhoneNumber.ShortCodeApplication, second : PhoneNumber.ShortCodeApplication ) : number => second.submittedAt.localeCompare( first.submittedAt ) );

        const paged : Paging.Result<PhoneNumber.ShortCodeApplication> = Paging.paginate( applications, query );
        return { status: NetworkUtils.Status.OK, data: paged };
    }
}

export default GetRegistrationShortCodeApplicationsImpl;
// eof
