//
import { GetVoiceCallsLog, Voice } from "@repo/api";
import { NetworkUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";

import VoiceService from "../services/VoiceService";

//
// List the account's call-log rows, newest first, optionally filtered by status (voice-7.1).
//
export class GetVoiceCallsLogImpl extends GetVoiceCallsLog
{
    private service : VoiceService;
    constructor( service : VoiceService ) { super(); this.service = service; }

    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        if( !auth.userId || !auth.accountId ) return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };

        const found : Type.Result<Array<Voice.CallLog>> = await this.service.listCalls( auth.accountId );
        if( !found.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "could not list calls" } };

        const status : Voice.Status | undefined = this.query.status;
        const records : Array<Voice.CallLog> = ( status ? found.data.filter( ( row : Voice.CallLog ) : boolean => row.status === status ) : found.data )
            .sort( ( a : Voice.CallLog, b : Voice.CallLog ) : number => b.createdAt.localeCompare( a.createdAt ) );

        return { status: NetworkUtils.Status.OK, data: { records } };
    }
}

export default GetVoiceCallsLogImpl;
// eof
