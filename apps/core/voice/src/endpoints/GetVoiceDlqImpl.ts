//
import { GetVoiceDlq, Voice } from "@repo/api";
import { NetworkUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";

import VoiceService from "../services/VoiceService";

//
// List dead-lettered voice messages (voice-5.0). APPLICATION.
//
export class GetVoiceDlqImpl extends GetVoiceDlq
{
    private service : VoiceService;
    constructor( service : VoiceService ) { super(); this.service = service; }

    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        if( !auth.userId ) return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };
        const found : Type.Result<Array<Voice.DlqItem>> = await this.service.listDlq( this.query.queue );
        if( !found.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "could not list the DLQ" } };
        return { status: NetworkUtils.Status.OK, data: { items: found.data } };
    }
}

export default GetVoiceDlqImpl;
// eof
