//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import { VoiceConfig } from "./model/VoiceConfig";

//
// Configure one provider entry in the factory (voice-3.1) — enable/disable + set its secretRef. APPLICATION.
//
export class PutVoiceProvider extends RestfulEndpoint< PutVoiceProvider.Query, PutVoiceProvider.Body, PutVoiceProvider.Response >
{
    public readonly uri      : string = PutVoiceProvider.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.PUT;
    public readonly access   : Access.Role = Access.AppRole.APPLICATION;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "setVoiceProvider",
        summary:     "Configure a voice provider",
        description: "Enables/disables a provider entry (and its secretRef) in the voice provider factory.",
        tags:        [ "Voice" ],
    };

    constructor( id? : string, body? : PutVoiceProvider.Body ) { super( { id: id ?? "" }, body ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return [ { field: "id", location: RestfulEndpoint.AttrLocation.URI, required: true } ]; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null
    {
        return {
            type: "object", additionalProperties: false, required: [ "enabled" ],
            properties: { enabled: { type: "boolean" }, secretRef: { type: "string" } },
        };
    }
}

export namespace PutVoiceProvider
{
    export const URI : string = apiPath( "voice", 1, "/providers/:id" );
    export interface Query { id : string; }
    export interface Body extends RestfulEndpoint.AuthRequest { enabled : boolean; secretRef? : string; }
    export interface Response { provider : VoiceConfig.ProviderEntry; }
    export enum Error
    {
        BAD_REQUEST  = NetworkUtils.Status.BAD_REQUEST,
        UNAUTHORIZED = NetworkUtils.Status.UNAUTHORIZED,
        FORBIDDEN    = NetworkUtils.Status.FORBIDDEN,
        NOT_FOUND    = NetworkUtils.Status.NOT_FOUND,
    }
}

export default PutVoiceProvider;
// eof
