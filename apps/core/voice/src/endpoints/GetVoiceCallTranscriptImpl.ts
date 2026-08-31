//
import { GetVoiceCallTranscript } from "@repo/api";
import { NetworkUtils } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";

import VoiceService from "../services/VoiceService";

//
// Spoken-call transcript for one call (voice-2.3).
//
export class GetVoiceCallTranscriptImpl extends GetVoiceCallTranscript
{
    private service : VoiceService;
    constructor( service : VoiceService ) { super(); this.service = service; }

    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        if( !auth.userId || !auth.accountId ) return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };
        const transcript : string | undefined = await this.service.transcriptFor( auth.accountId, this.query.callId );
        if( transcript === undefined ) return { status: NetworkUtils.Status.NOT_FOUND, data: { message: "no transcript for this call" } };
        return { status: NetworkUtils.Status.OK, data: { transcript } };
    }
}

export default GetVoiceCallTranscriptImpl;
// eof
