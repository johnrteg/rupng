//
import { PostVoiceDlqRequeue } from "@repo/api";
import { NetworkUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";

import VoiceService from "../services/VoiceService";

//
// Requeue dead-lettered voice messages (voice-5.0). APPLICATION.
//
export class PostVoiceDlqRequeueImpl extends PostVoiceDlqRequeue
{
    private service : VoiceService;
    constructor( service : VoiceService ) { super(); this.service = service; }

    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        if( !auth.userId ) return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };
        const body : PostVoiceDlqRequeue.Body | null = this.body;
        if( !body || !Array.isArray( body.items ) || body.items.length === 0 )
            return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "items is required" } };

        const requeued : Type.Result<number> = await this.service.requeueDlq( body.items );
        if( !requeued.ok ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "requeue failed" } };
        return { status: NetworkUtils.Status.OK, data: { requeued: requeued.data } };
    }
}

export default PostVoiceDlqRequeueImpl;
// eof
