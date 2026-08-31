//
import { PostVoiceCalls, Voice } from "@repo/api";
import { NetworkUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";

import VoiceService from "../services/VoiceService";

//
// S2S: enqueue a single outbound call (voice-1.1/1.3).
//
export class PostVoiceCallsImpl extends PostVoiceCalls
{
    private service : VoiceService;
    constructor( service : VoiceService ) { super(); this.service = service; }

    public async execute( _auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        const body : PostVoiceCalls.Body | null = this.body;
        if( !body || !Array.isArray( body.to ) || body.to.length === 0 || !body.callerId || ( !body.message && !body.flowId ) )
            return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "to, callerId, and one of message/flowId are required" } };

        const request : Voice.SendRequest = { ...body };
        const enqueued : Type.Result<string> = await this.service.enqueueCall( request );
        if( !enqueued.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "could not enqueue the call" } };
        return { status: NetworkUtils.Status.ACCEPTED, data: { queued: true, jobId: enqueued.data } };
    }
}

export default PostVoiceCallsImpl;
// eof
