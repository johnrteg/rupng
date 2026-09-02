//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import { Texting } from "./model/Texting";

//
// List the account's SMS/MMS send-log rows (texting-11.1), newest first — the data source for the
// Messages : Sent view (same shape as email's GetEmailLog).
//
export class GetTextingLog extends RestfulEndpoint< GetTextingLog.Query, undefined, GetTextingLog.Response >
{
    public readonly uri      : string = GetTextingLog.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.GET;
    public readonly access   : Access.Role = Access.AccountRole.USER;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "listTextingLog",
        summary:     "List sent SMS/MMS messages",
        description: "Lists the account's texting send-log rows (one per attempted message + its status), newest first.",
        tags:        [ "Texting" ],
    };

    constructor( query? : GetTextingLog.Query ) { super( query ?? {} ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap>
    { return [ { field: "status", location: RestfulEndpoint.AttrLocation.QUERY_PARAM, required: false } ]; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null { return null; }
}

export namespace GetTextingLog
{
    export const URI : string = apiPath( "texting", 1, "/log" );
    export interface Query { status? : Texting.DeliveryStatus; }
    export interface Response { records : Array<Texting.Message>; }
    export enum Error { UNAUTHORIZED = NetworkUtils.Status.UNAUTHORIZED }
}

export default GetTextingLog;
// eof
