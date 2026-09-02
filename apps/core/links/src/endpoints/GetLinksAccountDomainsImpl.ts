//
import { GetLinksAccountDomains, Links } from "@repo/api";
import { NetworkUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";
import LinksService from "../services/LinksService";

export class GetLinksAccountDomainsImpl extends GetLinksAccountDomains
{
    private service : LinksService;
    constructor( service : LinksService ) { super(); this.service = service; }

    ////////////////////////////////////////////////////////////////////////////////////////////
    public async execute( _auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        const accountId : string = this.query?.accountId ?? "";
        if( !accountId ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "accountId required" } };

        const found : Type.Result<Array<Links.ShortDomain>> = await this.service.listDomains();
        if( !found.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "domain registry read failed" } };

        const assigned : Array<Links.ShortDomain> = found.data.filter( ( row : Links.ShortDomain ) : boolean =>
            row.assignedAccountIds.includes( accountId ) || row.ownerAccountId === accountId );
        const domains : Array<string> = assigned.map( ( row : Links.ShortDomain ) : string => row.domain );
        const defaultDomain : Links.ShortDomain | undefined = assigned.find( ( row : Links.ShortDomain ) : boolean => row.defaultForAccountIds.includes( accountId ) );

        return { status: NetworkUtils.Status.OK, data: { domains, default: defaultDomain?.domain } };
    }
}

export default GetLinksAccountDomainsImpl;
// eof
