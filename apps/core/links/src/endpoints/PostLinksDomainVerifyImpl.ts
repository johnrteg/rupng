//
import { PostLinksDomainVerify, Links } from "@repo/api";
import { NetworkUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";
import LinksService from "../services/LinksService";

//
// MVP "fake automation" (links-5.3/5.6 deferred) — real DNS-verify + ACM cert provisioning doesn't
// exist yet; this immediately marks a `pending` domain `active` so mint isn't blocked in dev/test.
//
export class PostLinksDomainVerifyImpl extends PostLinksDomainVerify
{
    private service : LinksService;
    constructor( service : LinksService ) { super(); this.service = service; }

    ////////////////////////////////////////////////////////////////////////////////////////////
    public async execute( _auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        const id : string = this.query?.id ?? "";
        if( !id ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "id required" } };

        const found : Type.Result<Links.ShortDomain | undefined> = await this.service.getDomain( id );
        if( !found.ok )   return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "domain read failed" } };
        if( !found.data ) return { status: NetworkUtils.Status.NOT_FOUND, data: { message: "unknown domain" } };

        const verified : Links.ShortDomain = { ...found.data, status: Links.DomainStatus.ACTIVE, dnsVerifiedAt: new Date().toISOString(), certStatus: "issued" };
        const wrote : Type.Result<void> = await this.service.putDomain( verified );
        if( !wrote.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "domain write failed" } };

        return { status: NetworkUtils.Status.OK, data: verified };
    }
}

export default PostLinksDomainVerifyImpl;
// eof
