//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import { Voice } from "./model/Voice";

//
// Get a single call's status + normalized outcome by id (voice-7.1/8.0).
//
export class GetVoiceCall extends RestfulEndpoint< GetVoiceCall.Query, undefined, GetVoiceCall.Response >
{
    public readonly uri      : string = GetVoiceCall.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.GET;
    public readonly access   : Access.Role = Access.AccountRole.USER;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "getVoiceCall",
        summary:     "Get a call's status",
        description: "Fetches a single call's current status + normalized outcome by id.",
        tags:        [ "Voice" ],
    };

    constructor( callId? : string ) { super( { callId: callId ?? "" } ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return [ { field: "callId", location: RestfulEndpoint.AttrLocation.URI, required: true } ]; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null { return null; }
}

export namespace GetVoiceCall
{
    export const URI : string = apiPath( "voice", 1, "/calls/:callId" );
    export interface Query { callId : string; }
    export interface Response { call : Voice.CallLog; }
    export enum Error { UNAUTHORIZED = NetworkUtils.Status.UNAUTHORIZED, NOT_FOUND = NetworkUtils.Status.NOT_FOUND }
}

export default GetVoiceCall;
// eof
