//
import { GetVoiceCallRecording } from "@repo/api";
import { NetworkUtils } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";

import VoiceService from "../services/VoiceService";

//
// Recording playback for one call (voice-7.0) — a fresh presigned URL on every read.
//
export class GetVoiceCallRecordingImpl extends GetVoiceCallRecording
{
    private service : VoiceService;
    constructor( service : VoiceService ) { super(); this.service = service; }

    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        if( !auth.userId || !auth.accountId ) return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };
        const recordingUrl : string | undefined = await this.service.recordingPlaybackUrl( auth.accountId, this.query.callId );
        if( recordingUrl === undefined ) return { status: NetworkUtils.Status.NOT_FOUND, data: { message: "no recording for this call" } };
        return { status: NetworkUtils.Status.OK, data: { recordingUrl } };
    }
}

export default GetVoiceCallRecordingImpl;
// eof
