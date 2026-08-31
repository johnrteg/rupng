//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import { Voice } from "./model/Voice";

//
// List the account's saved IVR flows (voice-2.1).
//
export class GetVoiceFlows extends RestfulEndpoint< {}, undefined, GetVoiceFlows.Response >
{
    public readonly uri      : string = GetVoiceFlows.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.GET;
    public readonly access   : Access.Role = Access.AccountRole.USER;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "listVoiceFlows",
        summary:     "List IVR flows",
        description: "Lists the account's saved IVR flows (prompt → gather → branch).",
        tags:        [ "Voice" ],
    };

    constructor() { super( {} ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return []; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null { return null; }
}

export namespace GetVoiceFlows
{
    export const URI : string = apiPath( "voice", 1, "/flows" );
    export interface Response { flows : Array<Voice.IvrFlow>; }
    export enum Error { UNAUTHORIZED = NetworkUtils.Status.UNAUTHORIZED }
}

export default GetVoiceFlows;
// eof
