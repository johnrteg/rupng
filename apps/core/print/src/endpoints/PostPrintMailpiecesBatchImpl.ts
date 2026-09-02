//
import { PostPrintMailpiecesBatch } from "@repo/api";
import { NetworkUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";

import PrintService from "../services/PrintService";

//
// S2S: bulk submit a mailpiece batch for a campaign run (print-1.1/6.3).
//
export class PostPrintMailpiecesBatchImpl extends PostPrintMailpiecesBatch
{
    private service : PrintService;
    constructor( service : PrintService ) { super(); this.service = service; }

    public async execute( _auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        const body : PostPrintMailpiecesBatch.Body | null = this.body;
        if( !body?.accountId || !body.type || !body.templateId || !body.sender || !Array.isArray( body.recipients ) || body.recipients.length === 0 )
            return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "accountId, type, templateId, sender, and recipients are required" } };

        const enqueued : Type.Result<Array<string>> = await this.service.enqueueMailpiecesBatch( { ...body } );
        if( !enqueued.ok ) return { status: NetworkUtils.Status.FORBIDDEN, data: { message: enqueued.error ?? "could not enqueue the batch" } };
        return { status: NetworkUtils.Status.ACCEPTED, data: { queued: true, mailIds: enqueued.data } };
    }
}

export default PostPrintMailpiecesBatchImpl;
// eof
