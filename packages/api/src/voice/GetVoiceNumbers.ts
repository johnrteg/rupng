//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import { Voice } from "./model/Voice";

//
// List the account's configured caller-ID numbers (voice-8.0) — a READ; provisioning is out of scope here
// (SPECS.md delegates numbers + STIR/SHAKEN to `registration`, not yet built — voice owns a minimal copy of
// this table today, see PutVoiceProvider's sibling caller-ID admin surface as it lands).
//
export class GetVoiceNumbers extends RestfulEndpoint< {}, undefined, GetVoiceNumbers.Response >
{
    public readonly uri      : string = GetVoiceNumbers.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.GET;
    public readonly access   : Access.Role = Access.AccountRole.USER;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "listVoiceNumbers",
        summary:     "List caller-ID numbers",
        description: "Lists the account's configured voice-capable caller-ID numbers.",
        tags:        [ "Voice" ],
    };

    constructor() { super( {} ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return []; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null { return null; }
}

export namespace GetVoiceNumbers
{
    export const URI : string = apiPath( "voice", 1, "/numbers" );
    export interface Response { numbers : Array<Voice.NumberEntry>; }
    export enum Error { UNAUTHORIZED = NetworkUtils.Status.UNAUTHORIZED }
}

export default GetVoiceNumbers;
// eof
