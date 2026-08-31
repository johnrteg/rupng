//
import { GetVoiceNumbers, Voice } from "@repo/api";
import { NetworkUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";

import VoiceService from "../services/VoiceService";

//
// List the account's configured caller-ID numbers (voice-8.0).
//
export class GetVoiceNumbersImpl extends GetVoiceNumbers
{
    private service : VoiceService;
    constructor( service : VoiceService ) { super(); this.service = service; }

    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        if( !auth.userId || !auth.accountId ) return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };
        const found : Type.Result<Array<Voice.NumberEntry>> = await this.service.listNumbers( auth.accountId );
        if( !found.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "could not list numbers" } };
        return { status: NetworkUtils.Status.OK, data: { numbers: found.data } };
    }
}

export default GetVoiceNumbersImpl;
// eof
