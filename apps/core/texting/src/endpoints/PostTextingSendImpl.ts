//
import { PostTextingSend } from "@repo/api";
import { NetworkUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";
import TextingService from "../services/TextingService";

//
// Enqueue a single SMS/MMS send (texting-1.1). S2S only — see PostTextingSend's docs.
//
export class PostTextingSendImpl extends PostTextingSend
{
    private service : TextingService;
    constructor( service : TextingService ) { super(); this.service = service; }

    ///////////////////////////////////////////////////////////////////////////////////////////
    public async execute( _auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        const body : PostTextingSend.Body | null = this.body;
        if( !body?.accountId || !body.contactId || !body.idempotencyKey )
            return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "accountId, contactId, and idempotencyKey are required" } };

        const queued : Type.Result<void> = await this.service.enqueueSend( body );
        if( !queued.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "could not enqueue the send" } };

        return { status: NetworkUtils.Status.ACCEPTED, data: { queued: true } };
    }
}

export default PostTextingSendImpl;
// eof
