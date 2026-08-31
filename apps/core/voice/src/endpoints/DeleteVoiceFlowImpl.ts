//
import { DeleteVoiceFlow } from "@repo/api";
import { NetworkUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";

import VoiceService from "../services/VoiceService";

//
// Delete an IVR flow (voice-2.1).
//
export class DeleteVoiceFlowImpl extends DeleteVoiceFlow
{
    private service : VoiceService;
    constructor( service : VoiceService ) { super(); this.service = service; }

    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        if( !auth.userId || !auth.accountId ) return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };
        const removed : Type.Result<boolean> = await this.service.deleteFlow( auth.accountId, this.query.id );
        if( !removed.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "could not delete the flow" } };
        if( !removed.data ) return { status: NetworkUtils.Status.NOT_FOUND, data: { message: "flow not found" } };
        return { status: NetworkUtils.Status.OK, data: { deleted: true } };
    }
}

export default DeleteVoiceFlowImpl;
// eof
