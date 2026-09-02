//
import { DeleteLinksAccountDomain, Links } from "@repo/api";
import { NetworkUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";
import LinksService from "../services/LinksService";

export class DeleteLinksAccountDomainImpl extends DeleteLinksAccountDomain
{
    private service : LinksService;
    constructor( service : LinksService ) { super(); this.service = service; }

    ////////////////////////////////////////////////////////////////////////////////////////////
    public async execute( _auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        const accountId : string = this.query?.accountId ?? "";
        const domainName : string = this.query?.domain ?? "";
        if( !accountId || !domainName ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "accountId and domain are required" } };

        const found : Type.Result<Links.ShortDomain | undefined> = await this.service.getDomain( domainName );
        if( !found.ok )   return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "domain read failed" } };
        if( !found.data ) return { status: NetworkUtils.Status.OK, data: { unassigned: true } };   // already gone — idempotent

        const wrote : Type.Result<void> = await this.service.putDomain( {
            ...found.data,
            assignedAccountIds: found.data.assignedAccountIds.filter( ( id : string ) : boolean => id !== accountId ),
            defaultForAccountIds: found.data.defaultForAccountIds.filter( ( id : string ) : boolean => id !== accountId ),
        } );
        if( !wrote.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "domain write failed" } };

        return { status: NetworkUtils.Status.OK, data: { unassigned: true } };
    }
}

export default DeleteLinksAccountDomainImpl;
// eof
