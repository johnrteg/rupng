//
import { PutVoiceConfig, VoiceConfig } from "@repo/api";
import { NetworkUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";

import VoiceService from "../services/VoiceService";

//
// Set the voice service's runtime config. ROOT. Validates against VoiceConfig.SCHEMA before persisting.
//
export class PutVoiceConfigImpl extends PutVoiceConfig
{
    private service : VoiceService;
    constructor( service : VoiceService ) { super(); this.service = service; }

    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        if( !auth.userId ) return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };

        const body : PutVoiceConfig.Body | null = this.body;
        if( !body || !VoiceConfig.validate.is( body.config ) )
            return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "invalid voice config" } };

        const saved : Type.Result<void> = await this.service.saveConfig( body.config );
        if( !saved.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "could not save config" } };
        return { status: NetworkUtils.Status.OK, data: { config: body.config } };
    }
}

export default PutVoiceConfigImpl;
// eof
