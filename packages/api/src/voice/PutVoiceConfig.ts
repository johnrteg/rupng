//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import { VoiceConfig } from "./model/VoiceConfig";

//
// Set the voice service's runtime config (AppConfig-backed). ROOT. The body is the full VoiceConfig.Config;
// the impl validates against VoiceConfig.SCHEMA + persists to AppConfig (voice-4.0/10.0).
//
export class PutVoiceConfig extends RestfulEndpoint< {}, PutVoiceConfig.Body, PutVoiceConfig.Response >
{
    public readonly uri      : string = PutVoiceConfig.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.PUT;
    public readonly access   : Access.Role = Access.AppRole.ROOT;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "setVoiceConfig",
        summary:     "Set voice service config",
        description: "Replaces the voice service's runtime configuration (validated against the config schema).",
        tags:        [ "Voice" ],
    };

    constructor( body? : PutVoiceConfig.Body ) { super( {}, body ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return []; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    // the config is a nested object; validate loosely here (the impl runs the strict VoiceConfig.SCHEMA)
    public getBodySchema(): RestfulEndpoint.Schema | null
    { return { type: "object", additionalProperties: true, required: [ "config" ], properties: { config: { type: "object" } } }; }
}

export namespace PutVoiceConfig
{
    export const URI : string = apiPath( "voice", 1, "/config" );
    export interface Body extends RestfulEndpoint.AuthRequest { config : VoiceConfig.Config; }
    export interface Response { config : VoiceConfig.Config; }
    export enum Error
    {
        BAD_REQUEST  = NetworkUtils.Status.BAD_REQUEST,
        UNAUTHORIZED = NetworkUtils.Status.UNAUTHORIZED,
        FORBIDDEN    = NetworkUtils.Status.FORBIDDEN,
    }
}

export default PutVoiceConfig;
// eof
