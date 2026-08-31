//
import { PostVoiceDispatchSuspend } from "@repo/api";
import { NetworkUtils } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";

import VoiceService from "../services/VoiceService";

//
// Suspend an account's voice dispatch (voice-11.4 / SPECS.md gap #8). APPLICATION.
//
export class PostVoiceDispatchSuspendImpl extends PostVoiceDispatchSuspend
{
    private service : VoiceService;
    constructor( service : VoiceService ) { super(); this.service = service; }

    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        if( !auth.userId ) return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };
        const body : PostVoiceDispatchSuspend.Body | null = this.body;
        if( !body?.accountId ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "accountId is required" } };

        await this.service.workQueue.suspend( body.accountId );
        return { status: NetworkUtils.Status.OK, data: { suspended: true } };
    }
}

export default PostVoiceDispatchSuspendImpl;
// eof
