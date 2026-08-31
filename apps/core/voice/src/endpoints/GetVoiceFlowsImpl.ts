//
import { GetVoiceFlows, Voice } from "@repo/api";
import { NetworkUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";

import VoiceService from "../services/VoiceService";

//
// List the account's saved IVR flows (voice-2.1).
//
export class GetVoiceFlowsImpl extends GetVoiceFlows
{
    private service : VoiceService;
    constructor( service : VoiceService ) { super(); this.service = service; }

    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        if( !auth.userId || !auth.accountId ) return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };
        const found : Type.Result<Array<Voice.IvrFlow>> = await this.service.listFlows( auth.accountId );
        if( !found.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "could not list flows" } };
        return { status: NetworkUtils.Status.OK, data: { flows: found.data } };
    }
}

export default GetVoiceFlowsImpl;
// eof
