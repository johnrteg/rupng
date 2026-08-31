//
import { GetVoiceProviders, VoiceConfig } from "@repo/api";
import { NetworkUtils } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";

import VoiceService from "../services/VoiceService";

//
// List configured providers + status (voice-3.1). APPLICATION.
//
export class GetVoiceProvidersImpl extends GetVoiceProviders
{
    private service : VoiceService;
    constructor( service : VoiceService ) { super(); this.service = service; }

    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        if( !auth.userId ) return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };
        const config : VoiceConfig.Config = await this.service.voiceConfig();
        return { status: NetworkUtils.Status.OK, data: { providers: config.providers } };
    }
}

export default GetVoiceProvidersImpl;
// eof
