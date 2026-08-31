//
import { GetVoiceCall, Voice } from "@repo/api";
import { NetworkUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";

import VoiceService from "../services/VoiceService";

//
// Get a single call's status + normalized outcome by id (voice-7.1/8.0).
//
export class GetVoiceCallImpl extends GetVoiceCall
{
    private service : VoiceService;
    constructor( service : VoiceService ) { super(); this.service = service; }

    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        if( !auth.userId || !auth.accountId ) return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };

        const found : Type.Result<Voice.CallLog | undefined> = await this.service.getCall( auth.accountId, this.query.callId );
        if( !found.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "could not read the call" } };
        if( found.data === undefined ) return { status: NetworkUtils.Status.NOT_FOUND, data: { message: "call not found" } };
        return { status: NetworkUtils.Status.OK, data: { call: found.data } };
    }
}

export default GetVoiceCallImpl;
// eof
