//
import { PutVoiceProvider, VoiceConfig, Voice } from "@repo/api";
import { NetworkUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";

import VoiceService from "../services/VoiceService";

//
// Configure one provider entry in the factory — enable/disable + set its secretRef (voice-3.1). APPLICATION.
//
export class PutVoiceProviderImpl extends PutVoiceProvider
{
    private service : VoiceService;
    constructor( service : VoiceService ) { super(); this.service = service; }

    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        if( !auth.userId ) return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };

        const id : string = this.query.id;
        if( !( Object.values( Voice.Provider ) as Array<string> ).includes( id ) )
            return { status: NetworkUtils.Status.NOT_FOUND, data: { message: "unknown provider" } };

        const body : PutVoiceProvider.Body | null = this.body;
        if( !body ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "enabled is required" } };

        const config : VoiceConfig.Config = await this.service.voiceConfig();
        const entry : VoiceConfig.ProviderEntry = { provider: id as Voice.Provider, enabled: body.enabled, secretRef: body.secretRef };
        const next : VoiceConfig.Config = { ...config, providers: { ...config.providers, [ id ]: entry } };

        const saved : Type.Result<void> = await this.service.saveConfig( next );
        if( !saved.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "could not save config" } };
        return { status: NetworkUtils.Status.OK, data: { provider: entry } };
    }
}

export default PutVoiceProviderImpl;
// eof
