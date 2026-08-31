//
import { PostVoiceCallsBulk, Voice } from "@repo/api";
import { NetworkUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";

import VoiceService from "../services/VoiceService";

//
// S2S: enqueue one call per recipient in a bulk request (voice-1.1) — one queue message per request (the
// worker fans out per destination), same fast-enqueue shape as the single-call route.
//
export class PostVoiceCallsBulkImpl extends PostVoiceCallsBulk
{
    private service : VoiceService;
    constructor( service : VoiceService ) { super(); this.service = service; }

    public async execute( _auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        const body : PostVoiceCallsBulk.Body | null = this.body;
        if( !body || !Array.isArray( body.to ) || body.to.length === 0 || !body.callerId || ( !body.message && !body.flowId ) )
            return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "to, callerId, and one of message/flowId are required" } };

        const request : Voice.SendRequest = { ...body };
        const enqueued : Type.Result<string> = await this.service.enqueueCall( request );
        if( !enqueued.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "could not enqueue the batch" } };
        return { status: NetworkUtils.Status.ACCEPTED, data: { queued: true, jobIds: [ enqueued.data ] } };
    }
}

export default PostVoiceCallsBulkImpl;
// eof
