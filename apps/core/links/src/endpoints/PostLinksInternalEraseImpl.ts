//
import { PostLinksInternalErase } from "@repo/api";
import { NetworkUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";
import LinksService from "../services/LinksService";

//
// S2S forget hook (links-7.2) — called by contact's forget fan-out.
//
export class PostLinksInternalEraseImpl extends PostLinksInternalErase
{
    private service : LinksService;
    constructor( service : LinksService ) { super(); this.service = service; }

    ////////////////////////////////////////////////////////////////////////////////////////////
    public async execute( _auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        const body : PostLinksInternalErase.Body | null = this.body;
        if( !body?.accountId || !body.contactId ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "accountId and contactId are required" } };

        const erased : Type.Result<number> = await this.service.eraseContact( body.accountId, body.contactId );
        if( !erased.ok ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: erased.error } };

        return { status: NetworkUtils.Status.OK, data: { erased: erased.data } };
    }
}

export default PostLinksInternalEraseImpl;
// eof
