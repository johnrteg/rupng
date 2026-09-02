//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import { Print } from "./model/Print";

//
// List dead-lettered messages (print-9) — reads each `<queue>-dlq` companion (or just one, if `queue` is
// given). APPLICATION — an ops surface, not account-scoped.
//
export class GetPrintDlq extends RestfulEndpoint< GetPrintDlq.Query, undefined, GetPrintDlq.Response >
{
    public readonly uri      : string = GetPrintDlq.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.GET;
    public readonly access   : Access.Role = Access.AppRole.APPLICATION;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "listPrintDlq",
        summary:     "List dead-lettered print messages",
        description: "Lists messages sitting in a print queue's dead-letter companion, optionally filtered to one queue.",
        tags:        [ "Print" ],
    };

    constructor( query? : GetPrintDlq.Query ) { super( query ?? {} ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap>
    { return [ { field: "queue", location: RestfulEndpoint.AttrLocation.QUERY_PARAM, required: false } ]; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null { return null; }
}

export namespace GetPrintDlq
{
    export const URI : string = apiPath( "print", 1, "/dlq" );
    export interface Query { queue? : Print.DlqQueue; }
    export interface Response { items : Array<Print.DlqItem>; }
    export enum Error { UNAUTHORIZED = NetworkUtils.Status.UNAUTHORIZED, FORBIDDEN = NetworkUtils.Status.FORBIDDEN }
}

export default GetPrintDlq;
// eof
