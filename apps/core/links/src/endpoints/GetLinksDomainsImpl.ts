//
import { GetLinksDomains, Links } from "@repo/api";
import { NetworkUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";
import LinksService from "../services/LinksService";

export class GetLinksDomainsImpl extends GetLinksDomains
{
    private service : LinksService;
    constructor( service : LinksService ) { super(); this.service = service; }

    ////////////////////////////////////////////////////////////////////////////////////////////
    public async execute( _auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        const found : Type.Result<Array<Links.ShortDomain>> = await this.service.listDomains();
        if( !found.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "domain registry read failed" } };
        return { status: NetworkUtils.Status.OK, data: { records: found.data } };
    }
}

export default GetLinksDomainsImpl;
// eof
