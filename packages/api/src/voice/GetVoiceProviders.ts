//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import { VoiceConfig } from "./model/VoiceConfig";

//
// List configured providers + status (voice-3.1). APPLICATION — internal ops surface (below ROOT, above
// account-scoped roles) for the provider factory admin panel.
//
export class GetVoiceProviders extends RestfulEndpoint< {}, undefined, GetVoiceProviders.Response >
{
    public readonly uri      : string = GetVoiceProviders.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.GET;
    public readonly access   : Access.Role = Access.AppRole.APPLICATION;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "listVoiceProviders",
        summary:     "List configured voice providers",
        description: "Lists the voice provider factory's configured entries + enablement.",
        tags:        [ "Voice" ],
    };

    constructor() { super( {} ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return []; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null { return null; }
}

export namespace GetVoiceProviders
{
    export const URI : string = apiPath( "voice", 1, "/providers" );
    export interface Response { providers : Record<string, VoiceConfig.ProviderEntry>; }
    export enum Error { UNAUTHORIZED = NetworkUtils.Status.UNAUTHORIZED, FORBIDDEN = NetworkUtils.Status.FORBIDDEN }
}

export default GetVoiceProviders;
// eof
