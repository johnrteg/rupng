//
import { PostInternalSend, Email } from "@repo/api";
import { NetworkUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";
import EmailService from "../services/EmailService";

//
// S2S: enqueue a simple email send for an EXPLICIT account. Builds a plain Email.SendRequest (single literal
// recipient, inline body) and hands it to the SAME enqueueSend the PostEmailSend endpoint uses — this is only
// a new, no-RBAC entrypoint into the existing send pipeline, not a new send mechanism.
//
export class PostInternalSendImpl extends PostInternalSend
{
    private service : EmailService;
    constructor( service : EmailService ) { super(); this.service = service; }

    ///////////////////////////////////////////////////////////////////////////////////////////
    public async execute( _auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        const body : PostInternalSend.Body | null = this.body;
        if( !body || !body.accountId || !body.to || !body.subject || !body.body )
            return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "accountId, to, subject, and body are required" } };

        // a single literal recipient, inline html body — enqueue on the existing send pipeline
        const request : Email.SendRequest = {
            accountId: body.accountId,
            to:        [ { email: body.to } ],
            subject:   body.subject,
            html:      body.body,
        };
        const enqueued : Type.Result<string> = await this.service.enqueueSend( request, 0 );
        if( !enqueued.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "could not enqueue the send" } };

        return { status: NetworkUtils.Status.ACCEPTED, data: { sent: true, jobId: enqueued.data } };
    }
}

export default PostInternalSendImpl;
// eof
