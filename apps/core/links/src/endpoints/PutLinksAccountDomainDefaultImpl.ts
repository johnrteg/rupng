//
import { PutLinksAccountDomainDefault, Links } from "@repo/api";
import { NetworkUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";
import LinksService from "../services/LinksService";

//
// Set the account's default domain (links-6.2) — exactly one default at a time, so this also
// CLEARS the account from every other domain's `defaultForAccountIds`.
//
export class PutLinksAccountDomainDefaultImpl extends PutLinksAccountDomainDefault
{
    private service : LinksService;
    constructor( service : LinksService ) { super(); this.service = service; }

    ////////////////////////////////////////////////////////////////////////////////////////////
    public async execute( _auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        const accountId : string = this.query?.accountId ?? "";
        const domainName : string = this.body?.domain ?? "";
        if( !accountId || !domainName ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "accountId and domain are required" } };

        const registry : Type.Result<Array<Links.ShortDomain>> = await this.service.listDomains();
        if( !registry.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "domain registry read failed" } };

        const target : Links.ShortDomain | undefined = registry.data.find( ( row : Links.ShortDomain ) : boolean => row.domain === domainName );
        if( !target || !target.assignedAccountIds.includes( accountId ) )
            return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "domain is not assigned to this account" } };

        for( const row of registry.data )
        {
            const shouldBeDefault : boolean = row.domain === domainName;
            const isCurrentlyDefault : boolean = row.defaultForAccountIds.includes( accountId );
            if( shouldBeDefault === isCurrentlyDefault ) continue;   // no change needed for this row
            const defaultForAccountIds : Array<string> = shouldBeDefault
                ? [ ...row.defaultForAccountIds, accountId ]
                : row.defaultForAccountIds.filter( ( id : string ) : boolean => id !== accountId );
            await this.service.putDomain( { ...row, defaultForAccountIds } );
        }

        return { status: NetworkUtils.Status.OK, data: { default: domainName } };
    }
}

export default PutLinksAccountDomainDefaultImpl;
// eof
