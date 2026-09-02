//
import { GetLinksCode, Links } from "@repo/api";
import { NetworkUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";
import LinksService from "../services/LinksService";

//
// Read a code's metadata — target, targetType, status, attribution tuple (links-1.1). Tenant-scoped
// to the caller's acting account.
//
export class GetLinksCodeImpl extends GetLinksCode
{
    private service : LinksService;
    constructor( service : LinksService ) { super(); this.service = service; }

    ////////////////////////////////////////////////////////////////////////////////////////////
    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        if( !auth.accountId ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "no acting account (X-Account)" } };
        const code : string = this.query?.code ?? "";
        if( !code ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "code required" } };

        const found : Type.Result<Links.TrackedLink | undefined> = await this.service.lookup( code );
        if( !found.ok )   return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "link read failed" } };
        if( !found.data || found.data.accountId !== auth.accountId ) return { status: NetworkUtils.Status.NOT_FOUND, data: { message: "unknown code" } };

        return { status: NetworkUtils.Status.OK, data: found.data };
    }
}

export default GetLinksCodeImpl;
// eof
