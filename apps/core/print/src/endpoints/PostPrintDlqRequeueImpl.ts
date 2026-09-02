//
import { PostPrintDlqRequeue } from "@repo/api";
import { NetworkUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";

import PrintService from "../services/PrintService";

//
// Requeue dead-lettered print messages (print-9). APPLICATION.
//
export class PostPrintDlqRequeueImpl extends PostPrintDlqRequeue
{
    private service : PrintService;
    constructor( service : PrintService ) { super(); this.service = service; }

    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        if( !auth.userId ) return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };
        const body : PostPrintDlqRequeue.Body | null = this.body;
        if( !body || !Array.isArray( body.items ) || body.items.length === 0 )
            return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "items is required" } };

        const requeued : Type.Result<number> = await this.service.requeueDlq( body.items );
        if( !requeued.ok ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "requeue failed" } };
        return { status: NetworkUtils.Status.OK, data: { requeued: requeued.data } };
    }
}

export default PostPrintDlqRequeueImpl;
// eof
