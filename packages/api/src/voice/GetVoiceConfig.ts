//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import { VoiceConfig } from "./model/VoiceConfig";

//
// Read the voice service's runtime config (AppConfig-backed — default provider, per-account limits, quiet
// hours, provider registry). ROOT — platform operator surface (voice-4.0/10.0).
//
export class GetVoiceConfig extends RestfulEndpoint< {}, undefined, GetVoiceConfig.Response >
{
    public readonly uri      : string = GetVoiceConfig.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.GET;
    public readonly access   : Access.Role = Access.AppRole.ROOT;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "getVoiceConfig",
        summary:     "Get voice service config",
        description: "Reads the voice service's runtime configuration (default provider, per-account send limits, quiet hours, provider registry).",
        tags:        [ "Voice" ],
    };

    constructor() { super( {} ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return []; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null { return null; }
}

export namespace GetVoiceConfig
{
    export const URI : string = apiPath( "voice", 1, "/config" );
    export interface Response { config : VoiceConfig.Config; }
    export enum Error { UNAUTHORIZED = NetworkUtils.Status.UNAUTHORIZED, FORBIDDEN = NetworkUtils.Status.FORBIDDEN }
}

export default GetVoiceConfig;
// eof
