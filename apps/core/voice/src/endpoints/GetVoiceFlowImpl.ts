//
import { GetVoiceFlow, Voice } from "@repo/api";
import { NetworkUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";

import VoiceService from "../services/VoiceService";

//
// Get a single IVR flow by id (voice-2.1).
//
export class GetVoiceFlowImpl extends GetVoiceFlow
{
    private service : VoiceService;
    constructor( service : VoiceService ) { super(); this.service = service; }

    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        if( !auth.userId || !auth.accountId ) return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };
        const found : Type.Result<Voice.IvrFlow | undefined> = await this.service.getFlow( auth.accountId, this.query.id );
        if( !found.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "could not read the flow" } };
        if( found.data === undefined ) return { status: NetworkUtils.Status.NOT_FOUND, data: { message: "flow not found" } };
        return { status: NetworkUtils.Status.OK, data: { flow: found.data } };
    }
}

export default GetVoiceFlowImpl;
// eof
