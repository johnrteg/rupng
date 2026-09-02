//
import { PostPrintMailpieces } from "@repo/api";
import { NetworkUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";

import PrintService from "../services/PrintService";

//
// S2S: enqueue a single mailpiece (print-1.1/6.4).
//
export class PostPrintMailpiecesImpl extends PostPrintMailpieces
{
    private service : PrintService;
    constructor( service : PrintService ) { super(); this.service = service; }

    public async execute( _auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        const body : PostPrintMailpieces.Body | null = this.body;
        if( !body?.accountId || !body.type || !body.templateId || !body.recipient || !body.sender )
            return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "accountId, type, templateId, recipient, and sender are required" } };

        const enqueued : Type.Result<string> = await this.service.enqueueMailpiece( { ...body } );
        if( !enqueued.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "could not enqueue the mailpiece" } };
        return { status: NetworkUtils.Status.ACCEPTED, data: { queued: true, mailId: enqueued.data } };
    }
}

export default PostPrintMailpiecesImpl;
// eof
