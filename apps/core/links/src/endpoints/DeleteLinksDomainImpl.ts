//
import { DeleteLinksDomain } from "@repo/api";
import { NetworkUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";
import LinksService from "../services/LinksService";

export class DeleteLinksDomainImpl extends DeleteLinksDomain
{
    private service : LinksService;
    constructor( service : LinksService ) { super(); this.service = service; }

    ////////////////////////////////////////////////////////////////////////////////////////////
    public async execute( _auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        const id : string = this.query?.id ?? "";
        if( !id ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "id required" } };

        const removed : Type.Result<void> = await this.service.removeDomain( id );
        if( !removed.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "domain remove failed" } };

        return { status: NetworkUtils.Status.OK, data: { retired: true } };
    }
}

export default DeleteLinksDomainImpl;
// eof
