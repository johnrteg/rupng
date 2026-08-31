//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import { Voice } from "./model/Voice";

//
// List the account's call-log rows (voice-7.1), newest first — the data source for the calls activity view.
// Optionally filtered by status (e.g. only VOICEMAIL).
//
export class GetVoiceCallsLog extends RestfulEndpoint< GetVoiceCallsLog.Query, undefined, GetVoiceCallsLog.Response >
{
    public readonly uri      : string = GetVoiceCallsLog.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.GET;
    public readonly access   : Access.Role = Access.AccountRole.USER;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "listVoiceCallsLog",
        summary:     "List placed calls",
        description: "Lists the account's call-log rows (one per placed call + its status), newest first.",
        tags:        [ "Voice" ],
    };

    constructor( query? : GetVoiceCallsLog.Query ) { super( query ?? {} ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap>
    { return [ { field: "status", location: RestfulEndpoint.AttrLocation.QUERY_PARAM, required: false } ]; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null { return null; }
}

export namespace GetVoiceCallsLog
{
    export const URI : string = apiPath( "voice", 1, "/calls/log" );
    export interface Query { status? : Voice.Status; }
    export interface Response { records : Array<Voice.CallLog>; }
    export enum Error { UNAUTHORIZED = NetworkUtils.Status.UNAUTHORIZED }
}

export default GetVoiceCallsLog;
// eof
