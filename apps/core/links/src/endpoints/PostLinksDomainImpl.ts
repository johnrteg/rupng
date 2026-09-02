//
import { PostLinksDomain, Links } from "@repo/api";
import { NetworkUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";
import LinksService from "../services/LinksService";

//
// Add a domain to the registry (links-5.2) — starts `pending` (see PostLinksDomainVerifyImpl for
// the MVP "fake automation" that flips it to active).
//
export class PostLinksDomainImpl extends PostLinksDomain
{
    private service : LinksService;
    constructor( service : LinksService ) { super(); this.service = service; }

    ////////////////////////////////////////////////////////////////////////////////////////////
    public async execute( _auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        const body : PostLinksDomain.Body | null = this.body;
        if( !body?.domain || !body.kind ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "domain and kind are required" } };
        if( body.kind === Links.DomainKind.WHITELABEL && !body.ownerAccountId )
            return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "ownerAccountId required for a whitelabel domain" } };

        const existing : Type.Result<Links.ShortDomain | undefined> = await this.service.getDomain( body.domain );
        if( !existing.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "domain read failed" } };
        if( existing.data ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "domain already registered" } };

        const domain : Links.ShortDomain =
        {
            domain: body.domain, kind: body.kind, ownerAccountId: body.ownerAccountId,
            status: Links.DomainStatus.PENDING, assignedAccountIds: [], defaultForAccountIds: [],
            createdAt: new Date().toISOString(),
        };
        const wrote : Type.Result<void> = await this.service.putDomain( domain );
        if( !wrote.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "domain write failed" } };

        return { status: NetworkUtils.Status.OK, data: domain };
    }
}

export default PostLinksDomainImpl;
// eof
