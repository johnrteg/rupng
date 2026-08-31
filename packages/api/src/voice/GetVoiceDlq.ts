//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import { Voice } from "./model/Voice";

//
// List dead-lettered messages (voice-5.0) — reads each `<queue>-dlq` companion (or just one, if `queue` is
// given). APPLICATION — an ops surface, not account-scoped (a DLQ message may belong to any account). Items
// carry their `receiptHandle` + `body` together so `PostVoiceDlqRequeue` can resend the EXACT original body
// without re-receiving (a second receive would hand back a different receipt handle).
//
export class GetVoiceDlq extends RestfulEndpoint< GetVoiceDlq.Query, undefined, GetVoiceDlq.Response >
{
    public readonly uri      : string = GetVoiceDlq.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.GET;
    public readonly access   : Access.Role = Access.AppRole.APPLICATION;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "listVoiceDlq",
        summary:     "List dead-lettered voice messages",
        description: "Lists messages sitting in a voice queue's dead-letter companion, optionally filtered to one queue.",
        tags:        [ "Voice" ],
    };

    constructor( query? : GetVoiceDlq.Query ) { super( query ?? {} ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap>
    { return [ { field: "queue", location: RestfulEndpoint.AttrLocation.QUERY_PARAM, required: false } ]; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null { return null; }
}

export namespace GetVoiceDlq
{
    export const URI : string = apiPath( "voice", 1, "/dlq" );
    export interface Query { queue? : Voice.DlqQueue; }
    export interface Response { items : Array<Voice.DlqItem>; }
    export enum Error { UNAUTHORIZED = NetworkUtils.Status.UNAUTHORIZED, FORBIDDEN = NetworkUtils.Status.FORBIDDEN }
}

export default GetVoiceDlq;
// eof
