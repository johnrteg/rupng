//
import { PostEmailBatch, Email } from "@repo/api";
import { NetworkUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";
import EmailService from "../services/EmailService";

//
// Start a batch/blast (email-1.8/1.9). Validates the audience, creates a SCHEDULED blast (start resolved against
// the safe-buffer policy), and enqueues the paced fan-out. Returns the blast with a 202.
//
export class PostEmailBatchImpl extends PostEmailBatch
{
    private service : EmailService;
    constructor( service : EmailService ) { super(); this.service = service; }

    ///////////////////////////////////////////////////////////////////////////////////////////
    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        if( !auth.userId )    return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };
        if( !auth.accountId ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "no acting account (X-Account)" } };

        const body : PostEmailBatch.Body | null = this.body;
        const audience : Email.BatchAudience | undefined = body?.audience;
        const hasRecipients : boolean = ( audience?.recipients?.length ?? 0 ) > 0 || audience?.segmentId !== undefined;
        if( !audience || !hasRecipients ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "audience (recipients and/or segmentId) is required" } };

        const created : Type.Result<Email.Blast> = await this.service.createBlast( body as Email.BatchSendRequest, auth.accountId, auth.userId );
        if( !created.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "could not start the blast" } };

        return { status: NetworkUtils.Status.ACCEPTED, data: { blast: created.data } };
    }
}

export default PostEmailBatchImpl;
