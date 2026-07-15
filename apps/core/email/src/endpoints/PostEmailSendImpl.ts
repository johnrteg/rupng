//
import { PostEmailSend, Email } from "@repo/api";
import { NetworkUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";
import EmailService from "../services/EmailService";

//
// Enqueue a single email send (email-1.1). Validates the recipient list, stamps the acting account, computes
// any scheduled delay, and drops the request on the send queue — returns 202 immediately (the worker renders,
// gates, and delivers off the request path).
//
export class PostEmailSendImpl extends PostEmailSend
{
    private service : EmailService;
    constructor( service : EmailService ) { super(); this.service = service; }

    ///////////////////////////////////////////////////////////////////////////////////////////
    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        if( !auth.userId ) return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };

        const body : PostEmailSend.Body | null = this.body;
        if( !body || !Array.isArray( body.to ) || body.to.length === 0 ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "at least one recipient (to) is required" } };

        // stamp the acting account (unless it's an explicit platform/system send)
        const request : Email.SendRequest = { ...body, accountId: body.accountId ?? auth.accountId };

        // honor a scheduled start (delay ≤ safe-buffer-enforced 900s)
        const delaySeconds : number = await this.service.sendDelaySeconds( request.schedule );
        const enqueued : Type.Result<string> = await this.service.enqueueSend( request, delaySeconds );
        if( !enqueued.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "could not enqueue the send" } };

        return { status: NetworkUtils.Status.ACCEPTED, data: { queued: true, jobId: enqueued.data } };
    }
}

export default PostEmailSendImpl;
