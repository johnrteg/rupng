//
import { PostVoiceCallsTest, Voice } from "@repo/api";
import { NetworkUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";

import VoiceService from "../services/VoiceService";

//
// Place a test call to the composer's own verified number (voice-1.6). USER — the one user-facing "dial" route.
//
export class PostVoiceCallsTestImpl extends PostVoiceCallsTest
{
    private service : VoiceService;
    constructor( service : VoiceService ) { super(); this.service = service; }

    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        if( !auth.userId ) return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };

        const body : PostVoiceCallsTest.Body | null = this.body;
        if( !body || !body.to || !body.callerId || ( !body.message && !body.flowId ) )
            return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "to, callerId, and one of message/flowId are required" } };

        const request : Voice.SendRequest = {
            accountId: auth.accountId, to: [ body.to ], callerId: body.callerId, message: body.message, flowId: body.flowId,
            mergeData: body.mergeData, voicemailMessage: body.voicemailMessage, provider: body.provider,
        };
        const enqueued : Type.Result<string> = await this.service.enqueueCall( request );
        if( !enqueued.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "could not enqueue the test call" } };
        return { status: NetworkUtils.Status.ACCEPTED, data: { queued: true, jobId: enqueued.data } };
    }
}

export default PostVoiceCallsTestImpl;
// eof
