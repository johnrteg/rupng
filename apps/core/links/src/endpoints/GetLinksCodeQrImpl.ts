//
import { GetLinksCodeQr, Links } from "@repo/api";
import { NetworkUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";
import LinksService from "../services/LinksService";
import QrRenderer from "../providers/QrRenderer";

//
// Render a code's short URL as a QR glyph (links-3.1).
//
export class GetLinksCodeQrImpl extends GetLinksCodeQr
{
    private service : LinksService;
    constructor( service : LinksService ) { super(); this.service = service; }

    ////////////////////////////////////////////////////////////////////////////////////////////
    public async execute( _auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        const code : string = this.query?.code ?? "";
        if( !code ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "code required" } };

        const found : Type.Result<Links.TrackedLink | undefined> = await this.service.lookup( code );
        if( !found.ok )   return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "link read failed" } };
        if( !found.data ) return { status: NetworkUtils.Status.NOT_FOUND, data: { message: "unknown code" } };

        const url : string = `https://${ found.data.domain }/${ found.data.code }`;
        const png : string = await QrRenderer.renderPng( url );
        return { status: NetworkUtils.Status.OK, data: { png } };
    }
}

export default GetLinksCodeQrImpl;
// eof
